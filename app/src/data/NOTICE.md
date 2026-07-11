# Data licenses

Provenance and license for every generated file in this directory
(PLAN.md §3 item 5). Extended as basemap/star catalog data are added.

## besselian-2026.json

Computed by [`eclipse-calc`](https://github.com/lkangas/eclipse-calc)
(MIT license), a first-party tool, from JPL DE440s ephemeris data via
Skyfield. Not derived from or redistributing any third-party dataset —
no additional attribution required. Regenerate with
`tools/build-data/generate_besselian.py`.

## basemap.topojson

Countries + land, from [`world-atlas`](https://github.com/topojson/world-atlas)'s
bundled Natural Earth 1:50m data (ISC license — permissive, attribution
appreciated but not required; see `tools/build-data/node_modules/
world-atlas/LICENSE` after `npm install`). Clipped to the Iberia +
western Mediterranean + Balearics bbox and simplified with `mapshaper`.
Admin-1 province detail (a separate Natural Earth source) not yet
added. Regenerate with `tools/build-data/basemap.mjs`
(`npm run basemap` in `tools/build-data/`).
