# Data licenses

Provenance and license for every generated file in this directory
(PLAN.md §3 item 5). Extended as basemap/star catalog data are added.

## besselian-2026.json

Computed by [`eclipse-calc`](https://github.com/lkangas/eclipse-calc)
(MIT license), a first-party tool, from JPL DE440s ephemeris data via
Skyfield. Not derived from or redistributing any third-party dataset —
no additional attribution required. Regenerate with
`tools/build-data/generate_besselian.py`.

## shadow-frames.json

Computed directly by [`eclipse-calc`](https://github.com/lkangas/eclipse-calc)
(MIT license), a first-party tool — central line, N/S umbral limits,
and their terminator-crossing endpoints. Not derived from or
redistributing any third-party dataset — no additional attribution
required. Regenerate with `tools/build-data/generate_shadow_frames.py`.

## shadow-frames-global.json

Computed directly by [`eclipse-calc`](https://github.com/lkangas/eclipse-calc)
(MIT license), a first-party tool — whole-event central line, N/S
umbral limits, and their terminator-crossing endpoints (at both the
start and end of the window, unlike `shadow-frames.json`'s single
trailing-only terminator field), for the small global-overview map.
Not derived from or redistributing any third-party dataset — no
additional attribution required. Covers the entire 2026-08-12 umbral
path (Arctic Russia to the western Mediterranean), auto-discovered and
sampled at a coarser step than `shadow-frames.json`'s fixed 1s Spain-
window grid, appropriate for a small thumbnail rather than path-
accuracy work. Regenerate with
`tools/build-data/generate_shadow_frames_global.py`.

## eclipse-times.json

Computed directly by [`eclipse-calc`](https://github.com/lkangas/eclipse-calc)
(MIT license), a first-party tool — the whole-event "global
circumstances" table (the standard "Eclipse Times" table published by
every eclipse calculator: ytliu.epizy.com, NASA GSFC/EclipseWise,
etc.), not tied to any one observer. Not derived from or redistributing
any third-party dataset — no additional attribution required. Verified
against ytliu.epizy.com's published table for this exact eclipse (JPL
DE441, ΔT=69.2s vs. this app's locked 69.1s): every included event
matches to within ~0.06 degrees and ~3 seconds. Of the standard
16-row table, 5 rows are deliberately omitted rather than reported
wrong — CM (a polar-eclipse-specific event, out of scope) and SP1/SU1/
NU1/SP2 (the *early* extreme north/south umbral-limit points and both
penumbral-limit points), where `eclipse_calc.shadow.shadow_limits`'s
tangent-point search is confirmed numerically unreliable this close to
this event's extreme near-polar (~75-77N), terminator-limited start —
see `generate_eclipse_times.py`'s header comment for the full
investigation and specific numbers. Regenerate with
`tools/build-data/generate_eclipse_times.py`.

## basemap.topojson

Countries + land, from [`world-atlas`](https://github.com/topojson/world-atlas)'s
bundled Natural Earth 1:50m data (ISC license — permissive, attribution
appreciated but not required; see `tools/build-data/node_modules/
world-atlas/LICENSE` after `npm install`). Clipped to Iberia + all of
mainland France + the western Mediterranean/Balearics bbox (widened from
an Iberia-only extent that cut off right at the Pyrenees) and simplified
with `mapshaper`. Admin-1 province detail (a separate Natural Earth
source) not yet added. Regenerate with `tools/build-data/basemap.mjs`
(`npm run basemap` in `tools/build-data/`).

## cities.json

Major cities (pop_max >= 300,000) within the same bbox as
`basemap.topojson`, from Natural Earth's "populated places" 1:10m
cultural vector layer — **public domain** (naturalearthdata.com/about/
terms-of-use/), no attribution required. Not bundled in the `world-atlas`
npm package (that package only ships land/countries), so fetched
directly from the community-maintained mirror
[nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector)
on GitHub, which republishes Natural Earth's shapefiles pre-converted to
GeoJSON. Name + lat/lon only, no labels rendered yet (a direct,
explicitly near-term follow-up). Regenerate with
`tools/build-data/cities.mjs` (`npm run cities` in `tools/build-data/`;
needs the raw GeoJSON downloaded first, see that script's header
comment).

## roads.topojson

Major highways only (Natural Earth's "Major Highway" `type`, not
"Secondary Highway"/"Road"/"Ferry Route") within the same bbox as
`basemap.topojson`, from Natural Earth's 1:10m "roads" cultural vector
layer — **public domain**, same terms as `cities.json` above. Also not
in the `world-atlas` npm package; fetched directly from Natural Earth's
own CDN as a shapefile (naturalearthdata.com's actual distribution
format, unlike the GeoJSON mirror used for cities). No attribute data
kept (`drop-table`) and no labels rendered yet, same reasoning as
`cities.json`. Regenerate with `tools/build-data/roads.mjs`
(`npm run roads` in `tools/build-data/`; needs the raw shapefile
downloaded and unzipped first, see that script's header comment).

## roads-minor.topojson

Same source, bbox, and license as `roads.topojson` above, one tier down
("Secondary Highway" rather than "Major Highway"). Rendered dimmer
(lower stroke-opacity, same stroke-width) so it reads as background
context under the major-highway layer. Regenerated by the same
`tools/build-data/roads.mjs` script/`npm run roads` command as
`roads.topojson` -- both files are written by one run.

## basemap-global.topojson

Same source and license as `basemap.topojson` above (`world-atlas`'s
Natural Earth 1:50m data, ISC license). A separate, much more coarsely
simplified layer for the Global map tab, which needs to show the whole
event path far outside `basemap.topojson`'s tight Iberia-only extent --
**the whole world**, not a bbox-clipped subset (see PLAN.md's Global-map
milestone entry: every mapshaper bbox-clip variant tried mishandled
Russia's Arctic coast one way or another; simplifying everything and
letting the client-side stereographic projection's own `.clipAngle()`
do the regional clipping at render time sidesteps it entirely, at a
still-reasonable ~100KB). Regenerate with
`tools/build-data/basemap-global.mjs` (`npm run basemap-global` in
`tools/build-data/`).

Mapshaper's topojson re-export of this large, unclipped source silently
corrupts polygon ring winding, which makes every ocean point test as
"land" (confirmed with `d3.geoContains()`: e.g. mid-Pacific Ocean read
as land before working around this). `-clean rewind` fixes that but was
found to reintroduce the *other* mapshaper bug this file already works
around (the no-bbox-clip one two paragraphs up) -- confirmed by scanning
for the same jump-artifact signature used to diagnose that one
originally: 0 such jumps without `-clean rewind`, 20 with it. Fixed
instead with a small custom post-process in `basemap-global.mjs` itself
(`fixWinding()`): finds backwards-wound rings via `d3.geoArea()` (>2π
steradians for an exterior ring means "wound backwards, encloses the
complement instead") and reverses just their arc-index order/sign at
the topology level -- doesn't touch a single coordinate, so it can't
reintroduce the jump-artifact bug no matter how mangled mapshaper's own
winding logic is. Verified against 5 known land/ocean points as part of
the build itself (the script throws if any mismatch). One known
residual: Cuba still mis-winds even after this fix, for reasons not
fully chased down -- not visible in this app (nowhere near the Global
tab's Arctic/Iceland crop) so left as a documented gap rather than a
blocker.

## stars.json

From the [HYG star database](https://github.com/astronexus/HYG-Database)
v4.1 "CURRENT", **CC BY-SA 4.0** — attribution required, and this
extracted/filtered subset is itself licensed CC BY-SA 4.0 (share-alike),
*not* MIT/ISC like the rest of this directory. Attribution: "Star data
from the HYG Database, © 2011–2025 Astronomy Nexus, CC BY-SA 4.0"
(surface this in the app's about/credits screen once one exists, not
just here). Filtered to **mag < 3** — not the ~6.5 naked-eye-dark-sky
limit PLAN.md originally assumed, since totality here is a low-
altitude, twilight-bright sky (Sec1), not a dark-sky session; only
bright stars/planets will actually be visible (confirmed with the
user). 174 stars. Regenerate with `tools/build-data/stars.mjs`
(`npm run stars` in `tools/build-data/`; needs the raw CSV downloaded
first, see that script's header comment).

## elevation.json

Elevation-above-sea-level grid (571x1021, 1/60-degree spacing, ~1.4-1.9km
at this latitude) from [ETOPO 2022, 60 Arc-Second Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model)
(NOAA National Centers for Environmental Information) -- **public
domain** (U.S. federal work), free for any use, no attribution
required. Blends topography and bathymetry, so coastal/island sites
(A Coruna, Santander, Palma de Mallorca) get valid elevation right up
to and past the shoreline, unlike land-only DEMs; sea cells are
negative, not clamped to 0 (the exposed `elevationAt()` clamps its own
*return value* to >=0 for display purposes -- the underlying grid still
carries real bathymetry). Clipped to the same bbox as basemap.topojson
and resampled to the source's own native ~60 arc-sec resolution (not
downsampled further, as an earlier version of this grid was -- see git
history -- once `elevation-fine.json` below existed for genuinely
terrain-sensitive work, there was no reason left to throw away resolution
here too). Fetched via ERDDAP griddap subsetting on NOAA PIFSC's
"oceanwatch" mirror (which serves this same NCEI-produced dataset), not
the full global grid. Backs `elevationAt()` -- the location picker's own
instant elevation display, and nothing else (see `elevation-fine.json`
below for the denser grid `eclipse/horizon.ts`'s terrain-obstruction
ray-march actually uses). Regenerate with
`tools/build-data/generate_elevation.py` (needs two raw netCDF chunks
pre-downloaded first, see that script's header comment).

## elevation-fine.json

Elevation-above-sea-level grid (3801x6801, 1/400-degree spacing, ~250-280m
at this latitude) from [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/)
(ESA/Copernicus, ~30m/1 arc-sec native, derived from TanDEM-X radar data via
DLR/Airbus Defence and Space) -- built for
[docs/HORIZON-PLAN.md](../../../docs/HORIZON-PLAN.md)'s horizon-obstruction
feature, which needs real nearby terrain (a hill a few km away, exactly
what matters at this event's 2-12deg Sun altitude) that `elevation.json`
above is too coarse to resolve. Used ONLY by that feature
(`data/elevationFine.ts`, consumed via `stores/horizonObstruction.ts`) --
deliberately NOT by `elevationAt()`/the location picker's own display,
which stays on the small grid above: this file is ~69MB embedded (as
base64, see below), and even via a lazily-triggered `import()` there's no
way to defer the cost of a browser parsing/compiling a bundle that much
bigger before ANYTHING in the app can run, given this project's
`file://`-compatibility requirement forces a single-file, non-code-split
build (`vite.config.ts`'s `format: 'iife'`) -- confirmed by direct
measurement, not assumption (see commit history around this file for the
actual before/after numbers). Keeping it out of `elevationAt()`'s own
path means that startup cost is paid once, off the app's main "does
everything work" critical path, only for the one feature that actually
needs this resolution.

**License: free of charge, worldwide, no time limit.** Attribution
required when distributing or communicating the data to the public --
per the license (`docs/HORIZON-PLAN.md`'s own research this session,
cross-checked against Sentinel Hub's published copy of the license PDF):

> © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018
> provided under COPERNICUS by the European Union and ESA; all rights
> reserved.

No bathymetry (a land-only DEM, unlike ETOPO) -- deliberately not a
concern here, ocean depth doesn't affect whether terrain blocks the Sun's
line of sight (see project memory "bathymetry-irrelevant-for-horizon-dem"):
void/missing data over open water (or any of the small number of tiles
Copernicus hasn't yet publicly released for a handful of countries --
confirmed Spain itself is fully published) is filled with 0 at generation
time, exactly correct for "no terrain there."

Fetched from the public AWS Open Data S3 bucket
(`arn:aws:s3:::copernicus-dem-30m`, `eu-central-1`, no AWS account/
credentials needed) as Cloud-Optimized GeoTIFFs tiled on a 1x1 degree
grid, read via GDAL's `/vsicurl/` virtual filesystem at a decimated
resolution matching this file's own target grid -- NOT downloaded in full
(~40MB/tile native) -- so only ~180 lightweight range-request reads are
needed, not ~7GB of raw tile downloads. Ships as a base64-encoded Int16
array **inside this JSON** (not a separate `.bin`) so it's bundled into
the JS at build time rather than fetched at runtime -- a runtime `fetch()`
of a sibling asset generally fails over `file://`, one of this app's two
officially-supported access modes (`docs/STATUS.md`'s field-deployment
notes). Needs a separate isolated Python venv with `rasterio`
(`tools/build-data/.venv-copernicus`, gitignored -- rasterio's PyPI wheel
requires numpy>=2, ABI-incompatible with the scipy/netCDF4 already pinned
in the shared `eclipse` conda env used by the other `tools/build-data/*.py`
scripts). Regenerate with `tools/build-data/generate_elevation_fine.py`
(see that script's own header comment for the one-time venv setup).
