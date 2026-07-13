# Eclipse Dashboard — 2026-08-12 Total Solar Eclipse (Spain)

An **offline-first** web dashboard for observing the 12 August 2026 total solar
eclipse from Spain.

## Status

Working app, T−30 days to the eclipse. See `docs/STATUS.md` for current
feature-by-feature status (kept up to date) and `docs/PLAN.md` for the
architecture/spec.

## Goals

- **Fully offline** — zero runtime network requests. All data (astronomy engine,
  star/planet catalog, Besselian elements, basemap vectors) is bundled or
  prefetched and clipped at build time.
- Sun & Moon position rendering, selectable **alt-az or equatorial** orientation.
- **Contacts 1–4** list with configurable **sound warnings**.
- Observer coordinates from: **manual entry, map click, device geolocation, or
  USB serial NMEA GPS**.
- **Eclipse-path map** with the Moon's shadow projected on the ground.
- **Time slider** for simulation + a robust **lock-to-live** mode for the real event.
- **All-sky** star/planet map + **zoomed setting-Sun** view (totality is near
  sunset in Spain, so the Sun is very low).

## Method

Eclipse geometry from standard **Besselian elements**. A build-time tool
prefetches and clips basemap data to the eclipse corridor so the shipped app
stays small.

## License

TBD — pending on `app/src/data/NOTICE.md`'s licensing question for
`constellation-lines.json` (Stellarium/HYG-derived; see `docs/STATUS.md`).
