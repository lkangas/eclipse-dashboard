"""Generate app/src/data/elevation.json -- a compact elevation-above-sea-level
grid covering the app's Iberia + western Mediterranean + Balearics bbox
(same bbox as basemap.mjs's BBOX, PLAN.md Sec14 #3), so the observer-location
picker can show/derive site altitude with zero runtime network calls.

Source: ETOPO 2022, 60 Arc-Second Global Relief Model (Ice Surface variant --
identical to Bedrock for our bbox, since Spain has no ice sheets), NOAA
National Centers for Environmental Information (NCEI). U.S. federal work,
public domain, free to use/redistribute (see app/src/data/NOTICE.md). It
blends topography+bathymetry so coastal/island sites (A Coruna, Santander,
Palma de Mallorca) get valid elevation right up to and past the shoreline,
unlike land-only DEMs.

Needs two raw netCDF chunks pre-downloaded into .cache/etopo2022/ (not
committed -- .cache/ is gitignored). Fetched via ERDDAP griddap subsetting
(avoids pulling the full global grid) on NOAA PIFSC's "oceanwatch" mirror,
which serves this same NCEI-produced dataset -- NCEI's own ERDDAP instance
doesn't currently list ETOPO 2022. The source grid uses 0-360 longitude, so
our bbox (-10.5 to 6.5) straddles the prime meridian and needs two requests:

    curl -o .cache/etopo2022/ETOPO_2022_v1_60s_west.nc "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.nc?z[(35):(44.5)][(349.5):(359.9916667)]"
    curl -o .cache/etopo2022/ETOPO_2022_v1_60s_east.nc "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.nc?z[(35):(44.5)][(0.0083333):(6.5)]"

Then run (needs netCDF4 + scipy in the eclipse conda env; numpy/scipy are
already there for other build steps, netCDF4 may need
`pip install netCDF4`):

    cd tools/build-data && python generate_elevation.py

Resamples the native ~60 arc-sec (~1.4km) source grid onto a coarser
1/24-degree (~0.04167 deg, ~4.2-4.6km at this latitude) lat/lon grid via
bilinear interpolation, to keep the bundled JSON small (a few hundred KB)
without sacrificing real accuracy -- the native grid is already fine enough
that this resampling is just a size optimization, not a resolution
compromise that matters for a picker UI. 1/24 deg divides the bbox's 9.5x17
degree span evenly (228x408 intervals), so the grid's edges land exactly on
the bbox boundary with no extrapolation needed.

elevationsM is row-major: row 0 = latMin (south edge), increasing north;
within each row, col 0 = lonMin (west edge), increasing east. Sea cells are
negative (bathymetry) -- not clamped to 0, that's correct/expected. Values
rounded to the nearest meter. The big elevationsM array is written without
indentation/whitespace (unlike this project's other data files) purely to
keep file size down; the surrounding metadata fields are still readable.

Commit the output JSON -- this only runs at build time, the app reads the
static file directly, never fetches it.
"""

import json
from pathlib import Path

import netCDF4 as nc
import numpy as np
from scipy.interpolate import RegularGridInterpolator

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / ".cache" / "etopo2022"
WEST_NC = CACHE_DIR / "ETOPO_2022_v1_60s_west.nc"
EAST_NC = CACHE_DIR / "ETOPO_2022_v1_60s_east.nc"
OUTPUT = HERE.parent.parent / "app" / "src" / "data" / "elevation.json"

# Same bbox as basemap.mjs (PLAN.md Sec14 #3): west, south, east, north.
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -10.5, 35.0, 6.5, 44.5

STEP = 1 / 24  # ~0.041667 deg; divides the bbox span evenly on both axes


def load_chunk(path, lon_offset=0.0):
    ds = nc.Dataset(path)
    lat = ds.variables["latitude"][:].astype(np.float64)
    lon = ds.variables["longitude"][:].astype(np.float64) + lon_offset
    z = np.asarray(ds.variables["z"][:, :], dtype=np.float64)
    ds.close()
    return lat, lon, z


def main():
    if not WEST_NC.exists() or not EAST_NC.exists():
        raise SystemExit(
            f"Missing raw ETOPO 2022 chunks in {CACHE_DIR} -- see this script's "
            "header comment for the curl commands to fetch them."
        )

    lat_w, lon_w, z_w = load_chunk(WEST_NC, lon_offset=-360.0)  # 0-360 -> -180..180
    lat_e, lon_e, z_e = load_chunk(EAST_NC)
    assert np.allclose(lat_w, lat_e), "west/east chunk latitude grids don't match"

    lon = np.concatenate([lon_w, lon_e])
    z = np.concatenate([z_w, z_e], axis=1)
    order = np.argsort(lon)
    lon = lon[order]
    z = z[:, order]
    lat = lat_w

    interp = RegularGridInterpolator((lat, lon), z, method="linear", bounds_error=False, fill_value=None)

    rows = round((LAT_MAX - LAT_MIN) / STEP) + 1
    cols = round((LON_MAX - LON_MIN) / STEP) + 1

    target_lat = LAT_MIN + np.arange(rows) * STEP
    target_lon = LON_MIN + np.arange(cols) * STEP
    LAT, LON = np.meshgrid(target_lat, target_lon, indexing="ij")  # shape (rows, cols)

    # Clip into source bounds -- the source grid's outermost sample sits
    # half a native pixel (~0.008 deg, <1km) inside our bbox edges, so this
    # avoids extrapolation for a negligible, sub-pixel difference.
    query_lat = np.clip(LAT, lat.min(), lat.max())
    query_lon = np.clip(LON, lon.min(), lon.max())
    pts = np.stack([query_lat.ravel(), query_lon.ravel()], axis=-1)
    values = interp(pts).reshape(rows, cols)

    elevations_m = np.rint(values).astype(np.int32).ravel(order="C").tolist()
    assert len(elevations_m) == rows * cols

    data = {
        "source": "ETOPO 2022 60 Arc-Second Global Relief Model, NOAA/NCEI -- public domain (US federal work)",
        "generated_by": "tools/build-data/generate_elevation.py",
        "latMin": LAT_MIN,
        "lonMin": LON_MIN,
        "latStep": STEP,
        "lonStep": STEP,
        "rows": rows,
        "cols": cols,
        "elevationsM": elevations_m,
    }

    # Compact (no indent) purely for the big array's sake -- see header comment.
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")))

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"Wrote {OUTPUT} (rows={rows}, cols={cols}, cells={rows * cols}, {size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
