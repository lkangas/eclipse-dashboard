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

Computed by `app/src/eclipse/path.ts` (this project's own tested port of
`eclipse-calc`'s central-line/shadow-limit math, MIT), a first-party
tool. Not derived from or redistributing any third-party dataset — no
additional attribution required. Regenerate with `npm run
gen:shadow-frames` in `app/` (needs `tsx`).

## basemap.topojson

Countries + land, from [`world-atlas`](https://github.com/topojson/world-atlas)'s
bundled Natural Earth 1:50m data (ISC license — permissive, attribution
appreciated but not required; see `tools/build-data/node_modules/
world-atlas/LICENSE` after `npm install`). Clipped to the Iberia +
western Mediterranean + Balearics bbox and simplified with `mapshaper`.
Admin-1 province detail (a separate Natural Earth source) not yet
added. Regenerate with `tools/build-data/basemap.mjs`
(`npm run basemap` in `tools/build-data/`).

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
