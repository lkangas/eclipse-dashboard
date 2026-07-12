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

Elevation-above-sea-level grid (229x409, 1/24-degree spacing) from
[ETOPO 2022, 60 Arc-Second Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model)
(NOAA National Centers for Environmental Information) -- **public
domain** (U.S. federal work), free for any use, no attribution
required. Blends topography and bathymetry, so coastal/island sites
(A Coruna, Santander, Palma de Mallorca) get valid elevation right up
to and past the shoreline, unlike land-only DEMs; sea cells are
negative, not clamped to 0. Clipped to the same bbox as
basemap.topojson and resampled from the native ~60 arc-sec grid via
bilinear interpolation to keep the bundle small (not a resolution
compromise -- the native grid is already fine enough that this is
purely a size optimization). Fetched via ERDDAP griddap subsetting on
NOAA PIFSC's "oceanwatch" mirror (which serves this same NCEI-produced
dataset), not the full global grid. Regenerate with
`tools/build-data/generate_elevation.py` (needs two raw netCDF chunks
pre-downloaded first, see that script's header comment).
