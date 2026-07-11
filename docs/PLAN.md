# Implementation Plan — Eclipse Dashboard (2026-08-12, Spain)

Status: **draft for review**. This is step 1 (plan). Step 2 is a mock UI.

---

## 1. What we're building & the constraints that shape everything

An **offline** web dashboard to observe the **12 August 2026 total solar eclipse**
from Spain. Three facts dominate every design choice:

1. **Fully offline — zero runtime network.** Everything (ephemeris engine, star
   catalog, Besselian elements, basemap vectors) is bundled or prefetched at
   build time. See `docs/PLAN.md` §3.
2. **The Sun is extremely low — a sunset eclipse.** Totality crosses Spain
   ~18:26–18:33 UT (20:26–20:33 **CEST**), with the Sun at only **~12° on the
   NW Atlantic coast down to ~2° over the Balearics**. The wide Sun view frames
   the low, setting Sun with room around it, and **horizon obstruction is a
   first-class concern** — a single hill can hide the whole event.
3. **Geometry from Besselian elements**, reduced to local circumstances per the
   standard (Explanatory Supplement / Meeus) method — ported from the user's
   existing Python, validated against it.

### Verified event facts (used across the app)

| Quantity | Value | Source confidence |
|---|---|---|
| Date / greatest eclipse | 2026-08-12, 17:47:06 TD (17:45:53.8 UT), off Iceland | high |
| Magnitude / gamma | 1.0386 / 0.8977 | high |
| Saros / max totality | 126 (#48/72) / 2m18s (off Iceland, not Spain) | high |
| Umbra over Spain | ~18:26 UT (Galicia) → ~18:33 UT (Balearics) | high |
| Local time | CEST = UTC+2 | high |
| Path width | ~294 km; Madrid & Barcelona **just outside** | high |

Representative Spanish sites (Sun altitude at mid-totality / totality duration),
cross-checked against two independent sources to <0.5° and ~2 s:

| Site | Alt | Totality | Note |
|---|---|---|---|
| A Coruña | ~12° | ~1m16s | Atlantic coast, highest Sun |
| Oviedo / Gijón | ~10° | ~1m45s | near centerline, best inland |
| León | ~9.6° | ~1m45s | |
| Burgos | ~8.2° | ~1m44s | |
| Santander | ~8.8° | ~1m03s | |
| **Bilbao** | ~8.2° | **~0m32s** | **northern edge — tiny shifts matter** |
| Zaragoza | ~5.9° | ~1m25s | dry inland, good haze odds |
| **Valencia** | ~4° | **~0m58s** | **southern edge** |
| Castellón / Peñíscola | ~4.4° | ~1m39s | sea horizon |
| **Palma de Mallorca** | ~2.4° | ~1m36s | **essentially setting-Sun** |

Design implications: (a) a **horizon/obstruction check** per chosen location;
(b) strong visual distinction between **edge sites** (short, position-sensitive
totality) and **centerline sites**; (c) all times shown as **CEST + UT**; (d)
atmospheric **extinction/reddening** modeled at low altitude.

---

## 2. Architecture & run model

The app is a **static single-page app with no backend** — the *same build* is
either served over the network (remote prototype review) or served locally (the
eclipse). It makes **zero network requests at runtime** either way.

**Feature gate:** geolocation and USB serial GPS need a browser "secure
context" = **HTTPS or `localhost`** — *not* `file://`, *not* plain
`http://<ip>`.

| Purpose | Served how | Secure ctx | Geo / Serial | Runtime net |
|---|---|---|---|---|
| **Prototype review, any machine** | VPS over **HTTPS** (or tunnel) | ✅ | ✅ remotely | loads over net (fine for review) |
| **The eclipse (offline, local)** | local server on `http://localhost` | ✅ | ✅ | none |
| Quick peek | `file://` double-click | ⚠️ | ❌ / ⚠️ | none |
| Best field UX (future) | Tauri/Electron portable `.exe` | ✅ (app scheme) | ✅ | none |

- **VPS review works** and is a good way to share across machines, but **must be
  HTTPS** (Caddy auto-TLS + a domain, or a Cloudflare/Tailscale tunnel); plain
  `http://<vps-ip>` disables geolocation/serial. Web Serial still works against a
  remote HTTPS site — the USB device is on the *client* and the browser mediates.
- **The eclipse must be local/offline** — trivial, it's the same static `dist/`.

**Local server on Win11 without admin — yes.** A high port (≥1024) bound to
`127.0.0.1` needs no elevation and raises no firewall prompt (loopback isn't
filtered; the prompt only appears for `0.0.0.0` binds). Zero-install option:
`python -m http.server 8000 --bind 127.0.0.1` (Python already present). `vite
preview` / `npx serve` also work (Node installs per-user, no admin). Most
bulletproof for the event: a **portable Tauri/Electron `.exe`** — no server, no
install, no admin, offline, double-click (deferred to a later milestone).

### Stack (decided)

- **Vite + TypeScript + Svelte**; Canvas 2D for the sky and map views. Vite's
  dev/preview server is itself a localhost secure context; `vite build` emits the
  static files served in every mode above.
- **astronomy-engine** (MIT, ~116 KB, 0 deps) — Sun/Moon/planet/star positions,
  alt-az, rise/set, parallax, phase, angular size (±1′, no runtime data files).
- **d3-geo + d3-zoom + topojson-client** (BSD) for the map, rendered to Canvas.
- No online maps, tile servers, or CDNs — everything vendored locally.

---

## 3. Offline data pipeline (build-time "constrain the area" tool)

A Node script, `tools/build-data/`, run once at build time (never at runtime),
that fetches and **clips** reference data to what the app needs, emitting compact
local assets under `src/data/`:

1. **Basemap** — download Natural Earth (public domain) via `world-atlas`
   (countries 50m, ISC) + `martynafford` admin-1 provinces (CC0). **Clip to a
   configurable bounding box** around the eclipse corridor (default: Iberia +
   western Mediterranean + Balearics), **simplify** with mapshaper, quantize,
   export **TopoJSON**. World GeoJSON (tens of MB) → **~50–200 KB** (tens of KB
   gzipped). This bbox is the "custom tool to constrain the area."
2. **Star catalog** — take HYG v4.3 (CC BY-SA 4.0), filter to **mag < 6.5**
   (~9,000 stars), keep only `ra, dec, mag, ci/spect, proper, bf`, quantize
   numeric precision → **a few hundred KB JSON**. Optional brightest-~1500 layer
   for fast first paint.
3. **Besselian elements** — a small JSON (`src/data/besselian-2026.json`),
   generated from the user's Python (`polynom_bessels.Bessels`, resolved
   §14 #4) so app and source math agree by construction — **not** NASA's
   published SEdata set (§15 keeps that only as a cross-check reference).
4. **Precomputed eclipse geometry** — from the user's Python (or our evaluator):
   central line + N/S umbral & penumbral limits as GeoJSON; and umbral shadow
   outlines on a **dense UT grid** (e.g. every 10–30 s) as JSON, so the map's
   moving shadow needs no runtime projection port (slider interpolates frames).
   Also where the **map rotation angle** (§8) would be computed and baked in —
   a fixed constant for this one event, not a runtime calculation.
5. Emit a `NOTICE` bundling all data licenses (all redistributable).

Everything downloaded here is checked for license and vendored; the shipped app
fetches nothing.

---

## 4. Eclipse computation core (`src/eclipse/`)

The one piece that **must** run at runtime for an *arbitrary* observer (map
click / GPS / geolocation): evaluate Besselian polynomials at time *t*, then run
the local-circumstances iteration.

**Port from the user's Python** (compact, ~a few hundred lines):

- `elements.ts` — polynomial evaluation of `x, y, d, μ, l1, l2` (+ `tan f1/f2`).
- `observer.ts` — geocentric `ρ·sinφ′, ρ·cosφ′` from lat/lon/height (WGS84
  flattening 0.99664719).
- `localCircumstances.ts` — contact-time solve for **C1–C4** (the reference
  Python uses a Skyfield bisection search, `find_discrete`/`find_minima`, not
  closed-form Newton iteration on l1/l2 as originally assumed here — the TS
  port may use either method as long as it validates against the Python
  oracle to the §12 tolerance). **Magnitude, obscuration, and
  position/parallactic angles are not in the oracle yet** — confirmed absent
  from every file in the reference Python (`docs/PYTHON_REVIEW_FINDINGS.md`
  §4). Ship these as assumed/placeholder values initially, **visually
  flagged as provisional** in the UI (§9/§10), rather than blocking the port
  on new Python work.
- `path.ts` — shadow-axis ∩ ellipsoid → central line; N/S limits; instantaneous
  ground **shadow ellipse** (elongated ~1/sin(altitude) — huge & stretched at
  Spain's low Sun). Already prototyped in the reference Python
  (`shadow_outlines`/`shadow_limits`, prototype-grade but algorithmically
  real) — this is a port, not a from-scratch derivation. *May be precomputed
  instead (§3.4).* Bonus available: `solve_gamma`/`rise_set_curves`/
  `terminator_events` for the sunset-limited path edges, directly relevant
  since Spain's event is itself sunset-limited.

**Element set is locked** to the user's Python (`polynom_bessels.Bessels`,
resolved §14 #4) as the single source of truth, generated fresh rather than
bundling NASA's separately-published SEdata set (see §15) — this also avoids
NASA's own ~1e-4 / ~4 s page-to-page discrepancies. **ΔT is locked to 69.1 s**
app-wide (§15).

**Validation oracle:** keep the Python as golden reference for what it
already covers (contacts, central line/limits, shadow outline). `tools/gen-
vectors` emits test vectors (contacts for N locations incl. edge cities); a
Vitest suite asserts the TS port matches to **sub-second**. This is how we
earn trust in the port. Magnitude/obscuration/position-angle/parallactic-
angle/semi-diameters have no oracle yet (see above) — validate those
separately (e.g. against published cross-checks) once implemented.

---

## 5. Coordinate input (`src/location/`)

One `observer` store `{lat, lon, elevation, source}`, fed by four inputs:

1. **Manual** — lat/lon/elev fields (decimal + DMS), validation, presets for the
   listed Spanish sites.
2. **Map click** — `projection.invert()` on the §7 map → lat/lon.
3. **Device geolocation** — `navigator.geolocation` (needs localhost/HTTPS;
   guarded with a clear "run on localhost" message on `file://`).
4. **USB serial GPS** — Web Serial: `requestPort()` on a click, read stream,
   `TextDecoderStream` → line-split **NMEA** (`$GPGGA`/`$GPRMC`), parse
   lat/lon/alt **and UTC** (GPS can also discipline the clock, §6). Handle
   disconnect/reconnect, baud selection, no-fix state.

Each source shows accuracy/quality; a **horizon-obstruction helper** (from §1)
warns when the chosen site's low western Sun is at risk.

---

## 6. Time control (`src/time/`)

A `clock` store exposing the "current simulated instant" plus mode:

- **Slider** across an event window (default C1−30m … C4+30m), with play/pause
  and speed (e.g. 0.25×–3600×), scrub, and snap-to-contact buttons.
- **Lock-to-live** — a prominent, unambiguous toggle that binds the clock to the
  real UTC now and follows it (the mode used *during* the eclipse). Clear
  visual + state distinction between SIM and LIVE so it's impossible to confuse.
- **Time source** for LIVE: system clock by default; optionally **GPS UTC** from
  the serial NMEA stream (shows offset vs system clock).
- Everything displayed as **UT and CEST** together; ΔT is **locked to 69.1 s**
  app-wide for the Besselian TD↔UT conversion (§15).

---

## 7. Sky rendering (`src/sky/`)

Canvas 2D. Shared projection module supports two selectable orientations:

- **All-sky view** — full hemisphere, **alt-az** (horizon-based) or
  **equatorial** (RA/Dec) orientation toggle; stars from the bundled HYG subset
  (size ∝ magnitude, tinted by B-V), planets and Sun/Moon from astronomy-engine
  (with phase), constellation lines optional, horizon + cardinal points,
  atmospheric extinction dimming near the horizon.
- **Wide view** — a *wider*-than-the-camera view of the sky around the low
  setting Sun (not the camera's actual framing), showing the Moon's disk
  overlapping the Sun (correct size/orientation from parallax-corrected
  positions), nearby stars/planets, the horizon line, and the Sun's track
  toward setting. A **FOV box overlay** marks where the user's fixed camera
  framing sits within that wider context, for tuning composition ahead of
  the event. Wide/All-sky are tabbed for now (§10).

Both update reactively from `clock` + `observer`. Contact geometry (Moon-Sun
overlap, position angles) comes from §4 so the sky view and the contact
list/warnings are always consistent.

---

## 8. Eclipse-path map (`src/map/`)

d3-geo + bundled TopoJSON (§3), rendered to Canvas with d3-zoom pan/zoom and
`invert()` click-to-select:

- Basemap: Spain + surroundings (extent = decision §14).
- Overlays (same `geoPath`, perfectly registered): **central line**, **N/S
  totality limits**, penumbral limits, the observer marker, and the **moving
  umbral shadow ellipse** driven by the time slider (interpolated precomputed
  frames, §3.4). The umbra is a long, thin, fast ellipse here because the Sun is
  so low.
- Click anywhere → sets observer → recomputes local circumstances live.
- **Two map tabs (future/noted, not built yet)**:
  1. **Spain (zoomed + rotated)** — the map panel is generally wide and
     rectangular, but the centerline crosses Spain on a shallow diagonal;
     rendering it that way wastes panel space in the corners. Idea: rotate
     the whole projection (at **build time**, not runtime — this is a fixed
     rotation for this one event) so the centerline renders **horizontal**,
     using the panel's shape fully. Rotation angle derived from **two chosen
     points on the centerline** (e.g. two specific times along the umbra's
     track); which two points is a **build-time config**, ideally with a
     small helper tool to preview/tune the rotation before locking it in,
     rather than hand-picking lat/lon by trial and error.
  2. **Global (whole path)** — the full path on a world/hemisphere view, from
     wherever it starts to wherever it ends. Needs **much less offline map
     detail** than the Spain tab (continent/coastline outlines only, no
     province-level data). Because the 2026-08-12 path sits awkwardly close
     to the North Pole (greatest eclipse is at ~65°N 25°W, off Iceland —
     §1), a standard equirectangular/Mercator-style projection would distort
     or clip it badly; needs a **special projection** for this tab. Candidate:
     **stereographic, centered near the point of greatest eclipse**. Details
     (exact center, framing) to be refined later.

---

## 9. Contacts & sound warnings (`src/contacts/`)

- **Contacts table** — compact, EO-inspired: Event / T± / time / altitude for
  C1, C2, Max, C3, C4, Sunset (columns still draft — confirm what's essential).
  Below it, a small **local circumstances** strip: totality **duration**,
  **magnitude**, **obscuration**, **Sun azimuth** at max (list still draft —
  confirm which metrics matter beyond these). Magnitude/obscuration have no
  oracle yet (§4) — show as assumed/placeholder values, visually flagged as
  provisional, until implemented.
- **Big countdown display** — large text, no separate label line: `EVENT±ttt`
  (e.g. `C2−00:41.6`), paired with the flat monochrome Sun/Moon schematic (§10).
  **Display logic**: normally show only the *one* next upcoming event
  (`C1−ttt` before C1, `C2−ttt` before C2, `C4−ttt` after C3, …). **Exception:**
  between C2 and C3 (during totality) show *two* lines, `MAX±ttt` and `C3−ttt`,
  since both are live-relevant while totality is running.
- **Configurable sound warnings** — per-contact, user-set lead times (e.g. beep
  at C2−2m, spoken countdown C2−10s, distinct tone at C2/C3). Web Audio for
  precise scheduled tones; optional **SpeechSynthesis** for spoken calls
  (offline voices).
- **Autoplay handling** — AudioContext starts suspended; an explicit "Enable
  sound / arm warnings" button `resume()`s it on a user gesture. Warnings are
  scheduled against the LIVE clock and re-armed if the clock/observer changes.
- Safety copy: eye-safety reminders around C1/C4 vs. totality.

---

## 10. UI layout

**Light theme, deliberately bare** — only attention-grabbing content, no
decorative micro-text or panel chrome (no title bars, no in-panel labels;
content is self-evident, same spirit as Eclipse Orchestrator). Iterated as
`design/*.html` wireframes before touching real code; current arrangement
(`design/layout-v3-fullscreen.html`) is a 2×2 quadrant grid, filling the
browser viewport (Chrome app-mode target), with **every divider a real
drag handle** (panels resizable; reordering deferred):

- top bar: observer name/coords + UT/CEST clocks (slim, always visible)
- top-left: contacts table + local circumstances (§9)
- bottom-left: big countdown + flat monochrome Sun/Moon schematic (§9) —
  circles only, no gradients/photorealism, no separate label line
- top-right: eclipse-path map (§8, always visible)
- bottom-right: Wide / All-sky (§7), tabbed for now — open question whether
  both need to be visible simultaneously instead
- time slider: deferred from the current mock, to be added along the bottom

Panel positions (which content sits in which quadrant) are easy to revisit —
already swapped once — because sizing no longer depends on which specific
panel occupies a slot (`flex:1 1 0` default on every pane).

---

## 11. Project structure

```
eclipse/
├─ docs/PLAN.md
├─ tools/
│  ├─ build-data/        # prefetch + clip basemap, stars, elements (offline gen)
│  └─ gen-vectors/       # golden test vectors from the Python oracle
├─ reference/            # user's Python (tracked; source of truth + oracle)
├─ src/
│  ├─ data/              # generated: basemap.topojson, stars.json, besselian-2026.json, shadow-frames.json
│  ├─ eclipse/           # ported Besselian → local circumstances + path
│  ├─ location/  time/  sky/  map/  contacts/
│  ├─ stores/            # observer, clock, settings
│  └─ main.ts, App.svelte
├─ test/                 # Vitest: port vs oracle, NMEA parse, projections
└─ index.html
```

---

## 12. Validation & testing

- **Port vs Python oracle** — sub-second contact-time match for ~20 locations
  incl. edge cities (Bilbao, Valencia).
- **Sanity vs published** — contact times/altitudes for the §1 cities within
  tolerance.
- **Unit tests** — NMEA parsing, projection round-trips (`project`∘`invert`),
  ΔT/TD↔UT, obscuration formula.
- **Manual e2e** — geolocation + a real/simulated NMEA serial stream; LIVE-mode
  countdown; sound arming across browsers (Chrome/Edge).

---

## 13. Milestones

0. **Plan** (this doc) ✅ pending review.
1. **Mock UI** (step 2) — full layout, all panels, fake/stub data, on localhost;
   inspectable in-browser. Wire stub buttons for geolocation/serial.
2. **Data pipeline** — build-data tool; bundle basemap + stars + elements.
3. **Eclipse core port** + oracle validation.
4. **Map + shadow** and **sky views** on real computation.
5. **Location inputs** (manual → map → geolocation → serial GPS).
6. **Time control** + LIVE lock + GPS clock.
7. **Contacts + sound warnings**.
8. **Polish / field-hardening**; optional **desktop (Tauri) packaging**.

Frequent commits throughout; remote added when appointed.

---

## 14. Decisions

Resolved:

1. **Stack** — ✅ **Vite + TypeScript + Svelte**, Canvas 2D rendering.
2. **Deployment** — ✅ same static build; **HTTPS on a VPS for remote review**,
   **local `http://localhost` for the offline eclipse** (no admin needed);
   portable **Tauri/Electron** desktop build a later upgrade.
3. **Map extent** — ✅ **Iberia (incl. mainland Portugal) + W-Mediterranean +
   Balearics.**
4. **Elements source** — ✅ **generate from the user's Python**
   (`polynom_bessels.Bessels`), not NASA's SEdata set. Confirmed feasible
   after review (`docs/PYTHON_REVIEW_FINDINGS.md`) — a working
   ephemeris-direct → degree-3-polynomial-fit generator already exists.
5. **ΔT** — ✅ **locked to 69.1 s** app-wide, rather than NASA SEdata's
   published 75.4 s (§15) — the Python is the designated oracle, so its own
   ΔT (Skyfield's model, ≈68.8 s for this date) governs, not a different
   source's separately-published constant.
6. **Missing local-circumstances pieces** (magnitude, obscuration,
   position/parallactic angle, Sun/Moon angular semi-diameters — confirmed
   absent from the reference Python) — ✅ **not blocking**: ship as
   assumed/placeholder values, visually flagged as provisional, and
   implement for real later rather than extending the Python oracle first.

Still open: none currently.

---

## 15. Appendix — ΔT lock and Besselian elements (cross-check reference)

**ΔT is locked to 69.1 s**, app-wide, for the Besselian TD↔UT conversion and
any longitude correction that comes with it (≈0.004178°/s · δT if this ever
changes). This matches the reference Python oracle (Skyfield's own ΔT model,
≈68.8 s for 2026-08-12) rather than NASA GSFC's SEdata constant below
(75.4 s) — the Python is the designated source of truth, so its ΔT governs,
even though NASA's number is independently defensible on its own terms.

**The app's actual Besselian elements are generated from the reference
Python** (`polynom_bessels.Bessels` — see `docs/PYTHON_REVIEW_FINDINGS.md`),
which fits a degree-3 polynomial to its own ephemeris-direct Skyfield/JPL
DE440s computation. The NASA table below is kept **only as an independent
cross-check reference** (alongside a second, separately-computed set from
ytliu.epizy.com using JPL DE441, also in the findings doc) — it is *not*
the locked source, and should not be bundled into `besselian-2026.json`.
Useful precisely because it's independent: the Python-derived elements agree
with it to ~5 significant figures, and the central line to ~200–400 m at
every spot-checked instant.

**NASA GSFC SEdata — cross-check only, do not use as the app's element
source.** Base time **T0 = 2026-08-12 18.000 TD**; evaluate
`a = a0 + a1·t + a2·t² + a3·t³`, `t = (T − T0)` in hours.

```
        a0            a1           a2           a3
x    0.4755140    0.5189249   -0.0000773   -0.0000080
y    0.7711830   -0.2301680   -0.0001246    0.0000038
d   14.7966700   -0.0120650   -0.0000030    0
μ   88.7477870   15.0030900    0            0        (deg)
l1   0.5379550    0.0000939   -0.0000121    0
l2  -0.0081420    0.0000935   -0.0000121    0        (negative ⇒ total)
tan f1 = 0.0046141   tan f2 = 0.0045911
ΔT ≈ 75.4 s per SEdata itself (NOT what the app uses — see above; NASA's
own pages also disagree by ~4 s internally, 71.4 vs 75.4, which is part of
why this app locks to the Python oracle instead of picking between them).
```

Ephemerides: NASA GSFC uses VSOP87/ELP2000-82; EclipseWise uses JPL DE405;
the reference Python uses JPL DE440s. All independently authoritative.
Sources: NASA GSFC Five Millennium Canon (`eclipse.gsfc.nasa.gov`),
EclipseWise, ytliu.epizy.com, cross-checked against timeanddate, tutiempo,
TheSkyLive, Sky & Telescope.
