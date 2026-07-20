"""Generate app/src/data/elevation-fine.json -- a denser elevation grid
(docs/HORIZON-PLAN.md "Tier 1") replacing elevation.json/elevation.mjs's
own ~1.4-1.9km ETOPO-derived grid, for the horizon-obstruction feature
(app/src/eclipse/horizon.ts). A "hill 3km away" -- exactly what matters at
this event's 2-12deg Sun altitude -- could fall entirely between two of
the old grid's points; this one is dense enough to actually resolve it.

Source: Copernicus DEM GLO-30 (ESA/Copernicus, ~30m/1 arc-sec, derived from
TanDEM-X). Free, worldwide, no account/credentials needed -- public AWS S3
bucket (arn:aws:s3:::copernicus-dem-30m, eu-central-1), Cloud-Optimized
GeoTIFFs tiled on a 1x1 degree grid. License: free of charge, worldwide, no
time limit; attribution required when redistributing --
"(c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018
provided under COPERNICUS by the European Union and ESA; all rights
reserved." (see app/src/data/NOTICE.md's own entry for the full text).

Bathymetry is NOT a concern here (direct confirmation, see project memory
"bathymetry-irrelevant-for-horizon-dem") -- ocean depth doesn't affect
whether terrain blocks the Sun's line of sight, so a land-only DEM with
void/no data over open water is exactly fine; those cells just fall back
to 0 (no terrain there, correctly meaning "no obstruction").

SPARSE, corridor-limited output (this changed -- see docs/HORIZON-PLAN.md):
a first version of this script wrote every cell of the whole Iberia+
Balearics bbox, which is ~90% open ocean at 250m resolution and produced a
69MB file -- over Cloudflare Pages' 25MiB-per-file limit. This version
instead reads tools/build-data/dem-mask.json (generated ahead of time by
generate_dem_mask.mjs from the real coastline plus the umbral totality
corridor, see that script for the exact geometry) and only samples the
cells the mask says are both land AND within the corridor (+ a small
ray-march margin) -- about 4.1M cells instead of 25.85M. The mask is
"column-major sparse": for each of the (mostly empty) 6801 possible grid
columns, zero or more row-spans of actually-stored cells. This script does
not change how DEM tiles are fetched (still one decimated /vsicurl/ read
per 1x1deg tile, see below) -- it only changes what it does with each
tile's decimated array afterward: instead of writing the whole array into
a dense in-memory grid, it copies out just the slices any mask span needs
from that tile, into a flat sparse output buffer.

Needs a SEPARATE isolated venv (tools/build-data/.venv-copernicus, gitignored)
with rasterio -- NOT the shared "eclipse" conda env used by
generate_elevation.py/generate_besselian.py/etc: rasterio's PyPI wheel
requires numpy>=2, which is ABI-incompatible with the scipy/netCDF4 already
pinned in that shared env (confirmed the hard way -- installing rasterio
there broke scipy.interpolate entirely; restored via `pip install
numpy==1.26.4` + `pip uninstall rasterio` before creating this isolated venv
instead). Set up once via:

    cd tools/build-data
    python -m venv .venv-copernicus
    ./.venv-copernicus/Scripts/python.exe -m pip install rasterio

Then run (dem-mask.json must already exist -- generated separately by
`node generate_dem_mask.mjs`, not by this script):

    cd tools/build-data
    ./.venv-copernicus/Scripts/python.exe generate_elevation_fine.py

Each tile is read via GDAL's /vsicurl/ virtual filesystem at a DECIMATED
resolution matching this script's own target grid -- NOT downloaded in
full (~40MB/tile native) -- letting GDAL's HTTP range-request + COG-overview
support fetch only what's actually needed for the requested output shape.
Confirmed empirically before committing to the full 180-tile run: opening
+ a decimated read of one real Spain-area tile took under 1.5s total, not
the multi-second-per-40MB-download this would otherwise cost. Every tile
in the domain is still read exactly as before, regardless of whether the
mask ends up needing any data from it -- this script does not skip tile
fetches based on the mask, only what happens to the data afterward.

A tile that fails to load (network hiccup, or one of the small number of
Public-release tiles Copernicus hasn't published for a handful of
countries -- not expected to matter for Spain, already confirmed reachable)
is retried a couple of times, then any mask spans that would have drawn
from it are left as 0 rather than aborting the whole run -- same
"missing/void = no terrain = no obstruction" reasoning as the bathymetry
point above.

Output is a single JSON file (not a separate .bin) with the Int16 grid
base64-encoded inline: `elevation.ts` imports it as an ordinary JS module
(bundled into the JS at build time), not fetched at runtime, since a
runtime fetch() of a sibling asset generally fails over file:// (the same
class of restriction that already broke ES-module loading over file://
earlier in this project) -- file:// is one of this app's two officially-
supported access modes (docs/STATUS.md), so this can't be a runtime fetch.
"""

import base64
import json
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling

HERE = Path(__file__).resolve().parent
MASK_PATH = HERE / "dem-mask.json"
OUTPUT = HERE.parent.parent / "app" / "src" / "data" / "elevation-fine.json"

# Domain bbox/step -- MUST match dem-mask.json's own lonMin/latMin/lonStep/
# latStep exactly (asserted below), since every row/col index formula on
# both sides (this script, generate_dem_mask.mjs, and the TS reader) relies
# on them being identical. The corridor narrowing itself lives entirely in
# the mask's sparse per-column spans, not in this bbox -- this bbox is just
# the outer bound the mask's columns/rows are indexed against.
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -10.5, 35.0, 6.5, 44.5
STEP = 1 / 400  # ~0.0025 deg, ~250-280m at this latitude

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
MAX_RETRIES = 2
RETRY_DELAY_S = 2
EPS = 1e-9  # boundary-rounding epsilon, same role as elsewhere in this file


def tile_name(lat0: int, lon0: int) -> str:
    ns = "N" if lat0 >= 0 else "S"
    ew = "E" if lon0 >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat0):02d}_00_{ew}{abs(lon0):03d}_00_DEM"


def read_tile(lat0: int, lon0: int, n_lat: int, n_lon: int) -> np.ndarray:
    """Decimated read of one 1x1deg tile, resampled to (n_lat, n_lon) --
    row 0 = north (raw GDAL convention), flipped by the caller. Raises on
    failure; caller handles retry/fallback."""
    name = tile_name(lat0, lon0)
    url = f"/vsicurl/{BUCKET}/{name}/{name}.tif"
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(url) as src:
            data = src.read(1, out_shape=(n_lat, n_lon), resampling=Resampling.bilinear)
            if src.nodata is not None:
                data = np.where(np.isclose(data, src.nodata), 0.0, data)
            data = np.nan_to_num(data, nan=0.0)
    return data


def load_mask() -> dict:
    with open(MASK_PATH, "r", encoding="utf-8") as f:
        mask = json.load(f)
    assert abs(mask["lonMin"] - LON_MIN) < EPS, "mask lonMin doesn't match this script's LON_MIN"
    assert abs(mask["latMin"] - LAT_MIN) < EPS, "mask latMin doesn't match this script's LAT_MIN"
    assert abs(mask["lonStep"] - STEP) < EPS, "mask lonStep doesn't match this script's STEP"
    assert abs(mask["latStep"] - STEP) < EPS, "mask latStep doesn't match this script's STEP"
    expected_cols = round((LON_MAX - LON_MIN) / STEP) + 1
    assert mask["cols"] == expected_cols, f"mask cols={mask['cols']} != expected {expected_cols}"
    assert len(mask["colSpanStart"]) == mask["cols"] + 1
    return mask


def build_span_columns(mask: dict) -> np.ndarray:
    """Expand colSpanStart (span-index ranges per column) into a per-span
    column-index array -- the piece of "column geometry" the mask doesn't
    hand over explicitly (spanLon/spanLatStart give the *coordinates*, not
    the raw column index this script needs to index into a tile's decimated
    2D array)."""
    col_span_start = mask["colSpanStart"]
    n_spans = len(mask["spanRowStart"])
    span_col = np.empty(n_spans, dtype=np.int64)
    for c in range(mask["cols"]):
        span_col[col_span_start[c]:col_span_start[c + 1]] = c
    return span_col


def build_tile_pieces(mask: dict, span_col: np.ndarray):
    """For every span, work out which 1x1deg Copernicus tile(s) its rows
    fall into -- usually one, but a span can cross a lat0 tile boundary
    (land intervals commonly run taller than 1deg of latitude; the mask's
    tallest span here is well over 400 rows), so a span may need pieces
    from several tiles stacked north-south. A span's column (hence lon0)
    is always a single fixed value, since a span never crosses a column.

    Returns a dict (lat0, lon0) -> list of (span_index, row_lo, row_hi)
    pieces, where [row_lo, row_hi) is a sub-range of that span's global row
    range covered by that particular tile -- exactly what the main tile
    loop needs to know which spans (and which of their rows) to fill in
    from each tile it reads, and which spans to leave at 0 if a tile fails.
    """
    span_row_start = mask["spanRowStart"]
    span_row_count = mask["spanRowCount"]
    span_lon = mask["spanLon"]
    span_lat_start = mask["spanLatStart"]
    n_spans = len(span_row_start)

    lat0_min = int(np.floor(LAT_MIN))
    lat0_max = int(np.floor(LAT_MAX - EPS))
    lon0_min = int(np.floor(LON_MIN))
    lon0_max = int(np.floor(LON_MAX - EPS))

    tile_pieces: dict = {}
    for s in range(n_spans):
        row_lo = span_row_start[s]
        row_hi = row_lo + span_row_count[s]

        lon0 = int(np.floor(span_lon[s] + EPS))
        lon0 = min(lon0_max, max(lon0_min, lon0))

        lat_first = span_lat_start[s]
        lat_last = lat_first + (span_row_count[s] - 1) * STEP
        tile_lat0_lo = min(lat0_max, max(lat0_min, int(np.floor(lat_first + EPS))))
        tile_lat0_hi = min(lat0_max, max(lat0_min, int(np.floor(lat_last + EPS))))

        for lat0 in range(tile_lat0_lo, tile_lat0_hi + 1):
            tile_row_lo = max(0, round((lat0 - LAT_MIN) / STEP))
            tile_row_hi = round((lat0 + 1 - LAT_MIN) / STEP)
            ov_lo = max(row_lo, tile_row_lo)
            ov_hi = min(row_hi, tile_row_hi)
            if ov_hi <= ov_lo:
                continue
            tile_pieces.setdefault((lat0, lon0), []).append((s, ov_lo, ov_hi))

    return tile_pieces


def main():
    mask = load_mask()
    span_row_start = mask["spanRowStart"]
    span_row_count = mask["spanRowCount"]
    n_spans = len(span_row_start)
    total_cells = int(sum(span_row_count))
    print(f"Mask: {mask['cols']} cols, {n_spans} spans, {total_cells:,} cells to sample")

    span_col = build_span_columns(mask)
    tile_pieces = build_tile_pieces(mask, span_col)

    span_data_offset = np.empty(n_spans, dtype=np.int64)
    offset = 0
    for s in range(n_spans):
        span_data_offset[s] = offset
        offset += span_row_count[s]
    assert offset == total_cells

    # Pre-zeroed: any span slice never touched below -- because its tile
    # failed to load, or (shouldn't happen, but harmless if it did) no tile
    # covers it -- is already "0 = no terrain = no obstruction".
    elevations = np.zeros(total_cells, dtype=np.int16)

    rows = round((LAT_MAX - LAT_MIN) / STEP) + 1
    cols = round((LON_MAX - LON_MIN) / STEP) + 1

    lat0_values = range(int(np.floor(LAT_MIN)), int(np.floor(LAT_MAX - EPS)) + 1)
    lon0_values = range(int(np.floor(LON_MIN)), int(np.floor(LON_MAX - EPS)) + 1)
    tiles = [(lat0, lon0) for lat0 in lat0_values for lon0 in lon0_values]
    print(f"{len(tiles)} tiles to fetch")

    t_start = time.time()
    failed = []
    for idx, (lat0, lon0) in enumerate(tiles):
        i_start = max(0, round((lat0 - LAT_MIN) / STEP))
        i_end = min(rows, round((lat0 + 1 - LAT_MIN) / STEP))
        j_start = max(0, round((lon0 - LON_MIN) / STEP))
        j_end = min(cols, round((lon0 + 1 - LON_MIN) / STEP))
        n_lat = i_end - i_start
        n_lon = j_end - j_start
        if n_lat <= 0 or n_lon <= 0:
            continue

        pieces = tile_pieces.get((lat0, lon0), [])

        ok = False
        for attempt in range(MAX_RETRIES + 1):
            try:
                data = read_tile(lat0, lon0, n_lat, n_lon)
                if pieces:
                    # Same flip as the old dense-grid version: row 0 from
                    # GDAL is north, but this grid's row index increases
                    # with increasing lat (south-to-north).
                    data_flipped = data[::-1, :]
                    for s, ov_lo, ov_hi in pieces:
                        col_in_tile = int(span_col[s]) - j_start
                        out_lo = int(span_data_offset[s]) + (ov_lo - span_row_start[s])
                        out_hi = int(span_data_offset[s]) + (ov_hi - span_row_start[s])
                        column_values = data_flipped[ov_lo - i_start:ov_hi - i_start, col_in_tile]
                        elevations[out_lo:out_hi] = np.clip(
                            np.rint(column_values), -32768, 32767
                        ).astype(np.int16)
                ok = True
                break
            except Exception as e:  # noqa: BLE001 -- deliberately broad, see module docstring
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY_S)
                else:
                    print(
                        f"  [{idx + 1}/{len(tiles)}] {tile_name(lat0, lon0)}: FAILED ({e}) "
                        f"-- leaving {len(pieces)} affected span-slice(s) at 0"
                    )
                    for s, ov_lo, ov_hi in pieces:
                        out_lo = int(span_data_offset[s]) + (ov_lo - span_row_start[s])
                        out_hi = int(span_data_offset[s]) + (ov_hi - span_row_start[s])
                        elevations[out_lo:out_hi] = 0  # already zero -- explicit for clarity
                    failed.append(tile_name(lat0, lon0))
        if ok and (idx + 1) % 10 == 0:
            elapsed = time.time() - t_start
            print(f"  [{idx + 1}/{len(tiles)}] {elapsed:.0f}s elapsed, ~{elapsed / (idx + 1) * (len(tiles) - idx - 1):.0f}s remaining")

    print(f"Done fetching. {len(failed)} tile(s) failed and were left at 0: {failed}")

    raw_bytes = elevations.tobytes(order="C")
    b64 = base64.b64encode(raw_bytes).decode("ascii")

    out = {
        "source": "Copernicus DEM GLO-30, ESA/Copernicus (TanDEM-X derived) -- free, attribution required, see NOTICE.md",
        "generated_by": "tools/build-data/generate_elevation_fine.py",
        "lonMin": mask["lonMin"],
        "lonStep": mask["lonStep"],
        "cols": mask["cols"],
        "latMin": mask["latMin"],
        "latStep": mask["latStep"],
        "colSpanStart": mask["colSpanStart"],
        "spanRowStart": mask["spanRowStart"],
        "spanRowCount": mask["spanRowCount"],
        "dtype": "int16",
        "encoding": "base64",
        "dataBase64": b64,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, separators=(",", ":")))

    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUTPUT} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
