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

Then run:

    cd tools/build-data
    ./.venv-copernicus/Scripts/python.exe generate_elevation_fine.py

Each tile is read via GDAL's /vsicurl/ virtual filesystem at a DECIMATED
resolution matching this script's own target grid -- NOT downloaded in
full (~40MB/tile native) -- letting GDAL's HTTP range-request + COG-overview
support fetch only what's actually needed for the requested output shape.
Confirmed empirically before committing to the full 180-tile run: opening
+ a decimated read of one real Spain-area tile took under 1.5s total, not
the multi-second-per-40MB-download this would otherwise cost.

A tile that fails to load (network hiccup, or one of the small number of
Public-release tiles Copernicus hasn't published for a handful of
countries -- not expected to matter for Spain, already confirmed reachable)
is retried a couple of times, then filled with 0 rather than aborting the
whole run -- same "missing/void = no terrain = no obstruction" reasoning
as the bathymetry point above.

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
OUTPUT = HERE.parent.parent / "app" / "src" / "data" / "elevation-fine.json"

# Same bbox as basemap.mjs/generate_elevation.py (PLAN.md Sec14 #3): the
# whole area an observer could plausibly chase weather to, not a narrow
# corridor (docs/HORIZON-PLAN.md Sec3's own "no fixed sites, no corridor"
# conclusion).
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -10.5, 35.0, 6.5, 44.5
STEP = 1 / 400  # ~0.0025 deg, ~250-280m at this latitude

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
MAX_RETRIES = 2
RETRY_DELAY_S = 2


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


def main():
    rows = round((LAT_MAX - LAT_MIN) / STEP) + 1
    cols = round((LON_MAX - LON_MIN) / STEP) + 1
    print(f"Target grid: {rows} x {cols} = {rows * cols:,} cells")

    grid = np.zeros((rows, cols), dtype=np.float32)

    lat0_values = range(int(np.floor(LAT_MIN)), int(np.floor(LAT_MAX - 1e-9)) + 1)
    lon0_values = range(int(np.floor(LON_MIN)), int(np.floor(LON_MAX - 1e-9)) + 1)
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

        ok = False
        for attempt in range(MAX_RETRIES + 1):
            try:
                data = read_tile(lat0, lon0, n_lat, n_lon)
                grid[i_start:i_end, j_start:j_end] = data[::-1, :]
                ok = True
                break
            except Exception as e:  # noqa: BLE001 -- deliberately broad, see module docstring
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY_S)
                else:
                    print(f"  [{idx + 1}/{len(tiles)}] {tile_name(lat0, lon0)}: FAILED ({e}) -- filling 0")
                    failed.append(tile_name(lat0, lon0))
        if ok and (idx + 1) % 10 == 0:
            elapsed = time.time() - t_start
            print(f"  [{idx + 1}/{len(tiles)}] {elapsed:.0f}s elapsed, ~{elapsed / (idx + 1) * (len(tiles) - idx - 1):.0f}s remaining")

    print(f"Done fetching. {len(failed)} tile(s) failed and were filled with 0: {failed}")

    elevations_i16 = np.clip(np.rint(grid), -32768, 32767).astype(np.int16)
    raw_bytes = elevations_i16.tobytes(order="C")
    b64 = base64.b64encode(raw_bytes).decode("ascii")

    data = {
        "source": "Copernicus DEM GLO-30, ESA/Copernicus (TanDEM-X derived) -- free, attribution required, see NOTICE.md",
        "generated_by": "tools/build-data/generate_elevation_fine.py",
        "latMin": LAT_MIN,
        "lonMin": LON_MIN,
        "latStep": STEP,
        "lonStep": STEP,
        "rows": rows,
        "cols": cols,
        "dtype": "int16",
        "encoding": "base64",
        "dataBase64": b64,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")))

    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUTPUT} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
