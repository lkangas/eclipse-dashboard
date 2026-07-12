# Implementation Plan — Eclipse Dashboard (2026-08-12, Spain)

Status: **in progress**. The mock UI (§10), `eclipse-calc` Python oracle,
eclipse-core TS port (§4), and data pipeline (§3) are all done and
validated. Milestone 4 has started: the mock has been mechanically ported
into real Svelte components (layout, CSS, all interactions) in `app/src/`,
still on stub/mock data. Next: replace that stub data panel-by-panel with
real computation (§4 eclipse-core + §3 data) and astronomy-engine. See §13
for a full per-milestone breakdown of what's done, in progress, and not
started.

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
   standard (Explanatory Supplement / Meeus) method — ported from
   `eclipse-calc` (a standalone, tested Python package; see §4/§11),
   validated against it.

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

**De-risk the Tauri `.exe` early, not at milestone 8.** User wants a quick,
standalone demonstration that a packaged Tauri `.exe` actually runs without
admin rights on the field laptop — **a deal-breaker for using this laptop
during the eclipse if it doesn't.** A minimal proof-of-concept (near-empty
Tauri app, built once, then run via plain double-click with no install step)
is worth doing soon and independently of the rest of the app's progress,
specifically so there's still time to fall back to the `http://localhost`
static-server path (already confirmed admin-free, above) if it fails —
discovering this at milestone 8 would leave no room to pivot.

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
2. **Star catalog** — take HYG (CC BY-SA 4.0), filter to **mag < 3** (not
   6.5 — naked-eye-dark-sky limit is far too dim for this event: totality
   is a low-altitude, twilight-bright sky, not a dark-sky viewing session,
   so only bright stars/planets will actually be visible), keep only
   `ra, dec, mag, ci/spect, proper, bf`, quantize numeric precision → a
   tiny JSON (order ~150-200 stars, not ~9,000).
3. **Besselian elements** — a small JSON (`src/data/besselian-2026.json`),
   generated from `eclipse-calc`'s `BesselianEclipse` (a standalone Python
   package, sibling repo `../eclipse-calc`, extracted and tidied from the
   original research Python — resolved §14 #4) so app and source math agree
   by construction — **not** NASA's published SEdata set (§15 keeps that
   only as a cross-check reference).
4. **Precomputed eclipse geometry** — from `eclipse-calc` (or our evaluator):
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

**Port from `eclipse-calc`** (a standalone, tested Python package — sibling
repo `../eclipse-calc`, see §11 — not the raw research sandbox directly).
Its module split maps fairly directly onto the TS port:

- `elements.ts` ← `eclipse_calc.elements` — polynomial evaluation of
  `x, y, d, mu0, l1, l2` (+ `tanf1/tanf2`).
- `observer.ts` ← `eclipse_calc.observer` — geocentric `ρ·sinφ′, ρ·cosφ′`
  from lat/lon/height (WGS84 flattening 0.99664719).
- `localCircumstances.ts` ← `eclipse_calc.contacts` — contact-time solve for
  **C1–C4** (a Skyfield bisection search, `find_discrete`/`find_minima`, not
  closed-form Newton iteration on l1/l2 as originally assumed here — the TS
  port may use either method as long as it validates against the
  `eclipse-calc` oracle to the §12 tolerance). **Magnitude, obscuration, and
  position/parallactic angles are not in the oracle** — confirmed absent
  from the whole package (`docs/PYTHON_REVIEW_FINDINGS.md` §4). Ship these
  as assumed/placeholder values initially, **visually flagged as
  provisional** in the UI (§9/§10), rather than blocking the port on new
  Python work.
- `path.ts` ← `eclipse_calc.central_line` + `.shadow` + `.terminator` —
  shadow-axis ∩ ellipsoid → central line; N/S limits; instantaneous ground
  **shadow ellipse** (elongated ~1/sin(altitude) — huge & stretched at
  Spain's low Sun). This is a port, not a from-scratch derivation — and
  unlike the original research-sandbox prototype it's now tested (27
  passing tests, regression-checked against independent reference data) and
  had three real bugs fixed during extraction (wrong tangent-condition
  coefficients for the penumbral case, a missing deg→rad conversion, and an
  unwrapped longitude — see the `eclipse-calc` repo history). **Known
  limitation carried over**: penumbral (non-umbral) N/S limits can fail to
  converge for the very wide penumbral cone — not needed by the current map
  (§8 uses umbral limits), flagged rather than blocking. Bonus available:
  `eclipse_calc.terminator`'s `rise_set_curves`/`terminator_events` for the
  sunset-limited path edges (validated to sub-second/~0.002° against the
  whole path's published start/end), directly relevant since Spain's event
  is itself sunset-limited.

**Element set is locked** to `eclipse-calc` (resolved §14 #4) as the single
source of truth, generated fresh rather than bundling NASA's
separately-published SEdata set (see §15) — this also avoids NASA's own
~1e-4 / ~4 s page-to-page discrepancies. **ΔT is locked to 69.1 s** app-wide
(§15).

**Validation oracle:** keep `eclipse-calc` as golden reference for what it
covers (contacts, central line/limits, shadow outline, terminator). `tools/
gen-vectors` emits test vectors (contacts for N locations incl. edge
cities) by calling the installed `eclipse-calc` package directly; a Vitest
suite asserts the TS port matches to **sub-second**. This is how we earn
trust in the port. Magnitude/obscuration/position-angle/parallactic-
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
- **Two map tabs** (✅ both built now, see §13 for the full history):
  1. **Spain (zoomed + rotated)** — ✅ done. The centerline crosses Spain on
     a shallow diagonal, wasting panel space in the corners of the wide
     rectangular panel; fixed with a fixed `SPAIN_ROTATION_DEG = 30`
     applied via `spainProjection.angle()` before `fitExtent` -- a
     modest tilt, not a fully leveled line (one locked constant, not a
     dynamic per-frame angle or a two-point build-time config tool —
     simpler than originally
     sketched here, per direct request once the rotation idea came up
     again in practice).
  2. **Global (whole path)** — ✅ done. Stereographic, centered near the
     point of greatest eclipse (~65°N 25°W, off Iceland), as guessed
     here — implemented as a proper `d3-geo` custom raw projection (not
     equirectangular/Mercator, which would badly distort/clip a path
     this close to the pole). Real coastline (a new, wider but coarser
     `basemap-global.topojson`), the real whole-event central line + N/S
     umbral limits (`shadow-frames-global.json`, auto-discovered window,
     not hand-typed), and the **momentary penumbral shadow** outline
     (`shadowOutlineAt(..., 'penumbra')`) as its moving-shadow overlay,
     underneath the umbral one — all as anticipated here.

---

## 9. Contacts & sound warnings (`src/contacts/`)

- **Contacts table** — compact, EO-inspired: Event / T± / time / altitude for
  C1, C2, Max, C3, C4, Sunset (columns still draft — confirm what's essential).
  Below it, a small **local circumstances** strip: totality **duration**,
  **magnitude**, **obscuration**, **Sun azimuth** at max (list still draft —
  confirm which metrics matter beyond these). Magnitude/obscuration have no
  oracle yet (§4) — show as assumed/placeholder values, visually flagged as
  provisional, until implemented. This default view (local circumstances
  only) is intentionally scroll-free and must stay that way.
- **Global circumstances toggle** — ✅ done (see §13 for the full build
  history), simpler than sketched here: a plain show/hide button, the 11
  available global rows interleaved directly into the same table (not a
  separate fullscreen lightbox -- 11 extra rows didn't need one; revisit
  if a future expansion make the table genuinely too long). Modeled on
  the "Eclipse Times" section of ytliu.epizy.com's calculator (already
  used as a cross-check reference, §15) --
  https://ytliu.epizy.com/eclipse/one_solar_eclipse_general.html?ybeg=2001&ind=55&DE=441.
  Eventually extend the sound-warnings toggle below to cover entries in
  this table too, not just local contacts -- not started.
- **Big countdown display** — large text, no separate label line: `EVENT±ttt`
  (e.g. `C2−00:41.6`), paired with the flat monochrome Sun/Moon schematic (§10).
  **Display logic**: normally show only the *one* next upcoming event
  (`C1−ttt` before C1, `C2−ttt` before C2, `C3−ttt` after Max, `C4−ttt` after
  C3, …). **Exception:** between C2 and Max (not all the way to C3) show
  *two* lines, `MAX±ttt` and `C3−ttt` — once Max has passed, C3 *is* the
  next contact, so it reverts to a single line like everywhere else.
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

**Future: fullscreen lightbox.** Map and sky panels (both tabs of each —
Spain/Global, Wide/All-sky) should be click-to-expand into a fullscreen
lightbox view, for a closer look without resizing the whole 2×2 layout. The
same pattern is also wanted for the §9 global-circumstances table. Not
started.

---

## 11. Project structure

`eclipse-calc` (the Python oracle) is **not vendored into this repo** — it
lives in its own sibling repo, `../eclipse-calc` (a standalone, installable
package; see §4). `tools/build-data`/`tools/gen-vectors` depend on it via a
local editable install (`pip install -e ../eclipse-calc`) rather than a git
submodule or a copied-in `reference/` folder — simplest for a two-repo setup
on one machine, and avoids the submodule-detached-HEAD footguns for a solo
project. If `eclipse-calc` is ever pushed to GitHub, this can move to a
pinned git URL without changing the shape of the dependency. On this
machine that install lives in the **`eclipse` conda env**
(`C:\Users\lauri.kangas\AppData\Local\anaconda3\envs\eclipse`) — use that
env's `python.exe` to run any `tools/build-data/*.py` script.

```
eclipse/
├─ docs/PLAN.md
├─ tools/
│  ├─ build-data/        # prefetch + clip basemap, stars, elements (offline gen)
│  │                      #   depends on eclipse-calc (../eclipse-calc, pip install -e)
│  └─ gen-vectors/       # golden test vectors from the eclipse-calc oracle
├─ src/
│  ├─ data/              # generated: basemap.topojson, stars.json, besselian-2026.json, shadow-frames.json
│  ├─ eclipse/           # ported Besselian → local circumstances (per-observer, runtime)
│  ├─ location/  time/  sky/  map/  contacts/
│  ├─ stores/            # observer, clock, settings
│  └─ main.ts, App.svelte
├─ test/                 # Vitest: port vs oracle, NMEA parse, projections
└─ index.html
```

---

## 12. Validation & testing

- **`eclipse-calc` itself is already tested** (27 pytest cases, regression-
  checked against the independent reference tables in
  `docs/PYTHON_REVIEW_BRIEF.md` §0 — central line, N/S limits, 6 sites +
  Calamocha, whole-path start/end) — the TS port validates *against this*,
  it doesn't need to re-derive trust in the oracle itself from scratch.
- **Port vs `eclipse-calc` oracle** — sub-second contact-time match for ~20
  locations incl. edge cities (Bilbao, Valencia).
- **Sanity vs published** — contact times/altitudes for the §1 cities within
  tolerance.
- **Unit tests** — NMEA parsing, projection round-trips (`project`∘`invert`),
  ΔT/TD↔UT, obscuration formula.
- **Manual e2e** — geolocation + a real/simulated NMEA serial stream; LIVE-mode
  countdown; sound arming across browsers (Chrome/Edge).

---

## 13. Milestones

Status markers: ✅ done · 🟡 in progress / partial · ⬜ not started.

0. **Plan** (this doc) — ✅ done, kept current as decisions resolve (§14).
1. **Mock UI** — ✅ substantially done, `design/layout-v3-fullscreen.html`
   (fake/stub data throughout, inspectable via a local static server):
   - ✅ 2×2 resizable layout, zoom-invariant panel sizing
   - ✅ Contacts table + circumstances strip (static mock data)
   - ✅ Countdown + flat Sun/Moon schematic, single/dual-line totality logic
   - ✅ Time control: dual/triple curve slider, Live/Sim with confirm-guard,
     play/pause, drag-to-scrub
   - ✅ Map: Spain tab (real path/centerline/band, live shadow marker
     driven by the time slider, observer marker, click/drag-to-locate,
     manual coordinate entry) + Global (whole path) tab
   - 🟡 Sky panel (Wide/All-sky): first-pass stub content in place, visual
     polish still needed (flagged, not yet addressed)
   - 🟡 Location picker: functional but flagged as needing further work
   - ⬜ Geolocation/serial: UI placeholder only, not wired up (by design
     for this milestone — real wiring is milestone 5)
   - ⬜ Sound warnings: not started
2. **Data pipeline** (build-data tool; bundle basemap + stars + elements)
   — ✅ done:
   - ✅ `src/data/besselian-2026.json`: real Besselian coefficients + the
     locked 69.1s DeltaT, generated by `tools/build-data/
     generate_besselian.py` calling `eclipse-calc` directly. End-to-end
     tested (loads the actual shipped file, runs it through the real
     `findMaximumTime`/`findContactTimes`, reproduces Calamocha's known
     totality figures). `src/data/NOTICE.md` started.
   - ✅ `src/data/basemap.topojson`: countries + land from `world-atlas`'s
     Natural Earth 1:50m data, clipped to the Iberia+W-Med+Balearics
     bbox and simplified via `mapshaper` (756KB -> 4.9KB), generated by
     `tools/build-data/basemap.mjs`. End-to-end tested (decodes the
     real shipped file via `topojson-client`, checks Spain's extent).
     `tools/build-data` has its own `package.json` (mapshaper,
     world-atlas), kept out of the shipped app's dependencies.
     Admin-1 province detail not added — separate source, not needed
     by the mock's current map (no province-level detail shown there
     either)
   - ✅ `src/data/stars.json`: HYG v4.1, filtered to **mag < 3** (revised
     down from the originally-planned 6.5 — totality here is a low-
     altitude, twilight-bright sky, not dark-sky viewing, confirmed
     with the user), 174 stars brightest-first. End-to-end tested
     against real astronomy (Sirius/Canopus/Arcturus in the right
     order at their real positions), not just a schema check.
     CC BY-SA 4.0 (share-alike, unlike the rest of `src/data/`) —
     documented in `NOTICE.md` including the attribution line to
     surface later in the app's own credits screen. Admin-1 province
     basemap detail remains a later, separate follow-up if ever needed
3. **Eclipse core port** + oracle validation — ✅ done:
   - ✅ `eclipse-calc` itself: done, packaged, tested (27 passing pytest
     cases), independently re-verified this session (§4/§14 #4)
   - ✅ `tools/gen-vectors`: generates golden contact-time vectors from the
     oracle (§12); first output committed
   - ✅ `src/eclipse/elements.ts`: polynomial evaluation ported, validated
     against `eclipse-calc` to full float precision (Vitest, `app/`)
   - ✅ `src/eclipse/observer.ts`: geocentric rho*sin/cos(phi') ported
     (closed-form WGS84, no Skyfield dependency), validated to ~1e-8
   - ✅ `src/eclipse/localCircumstances.ts`: local-elements glue plus
     C1-C4 contact-time search. Uses safeguarded Newton (numerical
     derivative + bisection fallback) on the smooth signed distance
     function, not a port of eclipse-calc's boolean-step bisection
     search -- validated to sub-millisecond accuracy against all 13
     golden sites (well inside Sec12's sub-second tolerance)
   - ✅ `path.ts`: central line, N/S **umbral** limits, and the umbral
     shadow outline (footprint polygon), all validated against
     `eclipse-calc`; central line also cross-checked against the
     mock's independently-sourced PATH_CENTER data. Penumbral limits
     out of scope for this event (confirmed with the user); the
     penumbral shadow outline is a separate, later need for the
     Global map tab (§8), not urgent now. Found (and fixed upstream,
     `eclipse-calc` commit `f920613`) a real bug along the way: `L`
     leaked between the north/south tangent searches instead of
     resetting, spuriously dropping the south limit near the sunset
     cusp -- see project memory for the full trace
   - 99/99 Vitest cases pass across all four modules; `svelte-check`/
     `tsc`: 0 errors throughout
4. **Map + shadow** and **sky views** on real computation — 🟡 in progress:
   - ✅ Svelte app shell: the mock (§10) mechanically ported into real
     `app/src/` components -- `App.svelte` (2x2 resizable grid via a
     `resizable` action), `TopBar.svelte`, `ContactsPanel.svelte`,
     `CountdownPanel.svelte`, `MapPanel.svelte`, `SkyPanel.svelte`,
     `TimeBar.svelte` -- plus `stores/observer.ts` (§5) and
     `stores/clock.ts` (§6). All mock interactions preserved (resize,
     tabs, map click/drag-to-locate now writing to the real `observer`
     store, time-slider drag/play/curve-switch, Live/Sim arm-confirm
     guard, countdown dual/single dev toggle). Panel *content* is still
     the mock's stub/hardcoded data (Zaragoza reference contacts,
     hand-picked path coastline, placeholder sky alt-az) -- wiring real
     `eclipse-core` computation + `src/data/*` + astronomy-engine per
     panel is the next slice. `npm run test`: 105/105; `npm run check`:
     0 errors/warnings.
   - ✅ Wire ContactsPanel/CountdownPanel to `findContactTimes`/
     `findMaximumTime` against the live `observer` store, via a new
     `stores/localCircumstances.ts` derived store (recomputes on every
     observer change) and a shared `stores/now.ts` 1s-ticking clock (also
     now used by `TopBar`, replacing its own timer). Contact times/
     duration are real and match the known-correct Calamocha reference
     (101.6s totality) to the second. Gracefully degrades for observers
     outside the umbral path (C2/C3 show "--", circ strip says "no
     totality here") -- verified against Paris. Alt column and the
     Sunset row removed for now (need astronomy-engine and a terminator
     port, respectively, neither done yet) rather than left as stale
     stub numbers; Magnitude/Obscuration/Sun az (no oracle at all yet,
     §4/§14 #6) kept as placeholder values with a visible "provisional"
     flag (†) rather than silently presented as real. Both panels
     initially followed `stores/now` (real wall clock), which meant Sim
     mode moved the map's shadow marker and the time-slider cursor but
     left the contacts table/countdown showing real-time offsets --
     fixed to follow the new `effectiveTime` (§6 below) like everything
     else. The countdown's dual-line window is corrected to C2→Max only
     (not all the way to C3, per §9) -- once Max has passed, C3 is
     itself the next contact, so it's a single line like everywhere
     else; the manual single/dual dev toggle is removed now that the
     real phase detection covers it correctly. `npm run test`: 105/105;
     `npm run check`: 0 errors/warnings.
   - ✅ **Real Sunset, and a real bug it caught.** `findContactTimes`'s
     Besselian shadow-cone geometry has no concept of the horizon at
     all -- it happily reports C1-C4 (especially C3/C4) at any time the
     observer is geometrically in the shadow, even after the sun has
     actually set there. Confirmed this wasn't just an edge case:
     **C4 falls after sunset for Calamocha itself** (21:22:42 vs.
     sunset 21:07:46) -- for a location further east (39.0N 5.0E, near
     the map's eastern edge) sunset comes only ~6 minutes after C3.
     Fixed by installing `astronomy-engine` (the dependency PLAN.md §2
     already named for exactly this) and computing real local sunset
     (`Astronomy.SearchRiseSet`) in `stores/localCircumstances.ts`.
     Sunset is interleaved chronologically among C1-C4/Max in both the
     contacts table (`ContactsPanel`) and the time slider (`TimeBar`,
     dashed accent-colored line) rather than always shown last. Any
     contact after sunset is **dropped entirely, not just flagged**
     (per-project-owner correction: "non observable should not be
     visible at all") -- from `ContactsPanel`'s rows, from `TimeBar`'s
     `clineItems` (its `domainEnd` also caps at sunset rather than C4,
     so the track doesn't reserve space for a hidden contact), and from
     `CountdownPanel`'s "next event" logic. The first version of that
     last one only guarded C4 (the common case), missing that *any* of
     C2/Max/C3 can equally fall after sunset -- caught when the project
     owner found it counting down to a C2 that was never actually
     observable (sunset lands between C1 and C2 for some locations,
     e.g. 37.5N 6.5E). Rewritten to pick the next observable event out
     of C1-C4 uniformly (dual mode now requires C2/Max/C3 *all*
     observable) rather than special-casing "C4 might not be
     observable" -- once none are left, falls through to counting down
     to Sunset itself, then to "Event ended". `npm run test`: 55/55;
     `npm run check`: 0 errors/warnings.
   - 🟡 Wire MapPanel to `basemap.topojson` (d3-geo) + `path.ts`'s central
     line/limits/shadow outline, replacing the stub coastline/path arrays:
     - ✅ Spain-tab coastline is now the real `basemap.topojson`, via
       `d3-geo`'s `geoMercator` fitted to the data + `topojson-client`'s
       `feature()` (PLAN.md §2 stack decision) -- replaces the hand-drawn
       `COAST_IBERIA`/`BALEARICS` stub arrays (Balearic islands now come
       from the real data, no separate hand-drawn ellipses needed).
       Click/drag-to-locate now uses the projection's own `.invert()`
       instead of the hand-rolled inverse formula. `npm run test`:
       105/105; `npm run check`: 0 errors/warnings.
     - ✅ Central line + N/S umbral limits, precomputed at build time
       into `src/data/shadow-frames.json` (~145KB) -- static geometry
       for the whole event (not observer- or clock-dependent -- only
       *where along the fixed line* the marker sits depends on the
       clock), matching PLAN.md §3 item 4's original design.
       **Switched from a TypeScript port to generating directly from
       `eclipse-calc`** (`tools/build-data/generate_shadow_frames.py`,
       the `eclipse` conda env): once this geometry only needs to run
       once at build time, maintaining a parallel TS reimplementation
       (`src/eclipse/path.ts`) was pure overhead for code that never
       runs in the browser -- removed, along with `ellipsoid.ts` (only
       used by `path.ts`) and their dedicated tests. Only
       `elements.ts`/`observer.ts`/`localCircumstances.ts` remain
       client-side (genuinely needed for arbitrary runtime observer
       positions). 1s fixed grid (not yet adaptive -- next item).
     - ✅ **Terminator-crossing endpoint for all three lines.** Each of
       central line/north limit/south limit now gets one extra point
       snapped to the day/night terminator where the regular grid stops
       converging, rather than just trailing off:
       - Central line: root-find (`scipy.optimize.brentq`) on
         `1 - ksi^2 - eta1^2 = 0` -- the point where the shadow axis's
         own ground point leaves the visible disk as seen along the
         shadow axis, which (since that axis points roughly sunward) is
         the terminator itself. No new primitive needed.
       - N/S limits: `shadow_limits`' tangent search failing to
         converge and the shadow's edge circle starting to cross the
         terminator (`eclipse_calc.terminator.rise_set_curves`) turn
         out to be the *same event*, confirmed empirically (both land
         on the same 1s-grid sample, ~18:30:38 UT for the north limit).
         Of `rise_set_curves`' two crossing points, the one whose angle
         is closer to that limit's own convention (~180° north, ~0°
         south, per `shadow_limits`' own `L*cos(q)>0 => south` rule) is
         picked.
     - ✅ **Rendered points-and-lines (matplotlib `.-` style), not a
       smooth curve** -- deliberately diagnostic, not final polish: a
       small dot at every one of the ~3300 raw sample points (plus a
       distinct larger/red dot for each of the 3 terminator points), so
       gaps in the 1s grid near the terminator are visible while
       judging whether adaptive refinement is actually needed there.
       North/south limits also got their own explicit stroked
       polylines (previously only implicit as the shaded band's edge).
       **Not yet done: the adaptive timestep itself** -- deliberately
       deferred until the fixed-1s-grid rendering above has been
       visually reviewed.
       `npm run test`: 55/55 (down from 108 -- `path.ts`/`ellipsoid.ts`
       and their tests removed, not a regression); `npm run check`: 0
       errors/warnings.
     - ✅ Shadow marker now interpolates over the real UT timestamps of
       the sampled central-line grid above, driven by the real
       `effectiveTime` clock (see below) instead of a CEST-seconds stub
     - ✅ **Umbra outline** -- the umbral shadow's actual instantaneous
       footprint (not just its center point/the swept path band above),
       animated with `effectiveTime`. Unlike the central line/N-S limits,
       this is a function of "right now", so -- after an initial wrong
       attempt at precomputing it into a data file, same mistake as the
       swept-path pattern but not applicable here, caught and corrected
       -- it's computed live client-side each tick from the already-
       bundled Besselian coefficients (`eclipse/shadowOutline.ts`,
       reviving the `shadowOutlineAt` algorithm from the since-deleted
       `path.ts`/`ellipsoid.ts`, narrowed to just that one function).
       Evaluating one instant is cheap (~60 trig-heavy points), so no
       precomputation or caching needed. Renders as a filled, semi-
       transparent `<polygon>` in both the Spain and Global tabs.
       Terminator handling matters here too: a naive sweep just omits
       points that fall outside Earth's visible disk (expected late in
       the event, as the umbra nears the day/night boundary), which
       would leave a straight illegal chord across the shape instead of
       following the true curved edge -- fixed by detecting sign flips
       in an un-iterated visibility margin between adjacent sample
       angles and bisecting (25 iterations) to insert an exact
       terminator-crossing point at each of the (at most two)
       transitions, mirroring `generate_shadow_frames.py`'s own
       terminator root-finds for the central line/limits. Verified
       against eclipse-calc directly: golden-fixture match at three
       instants well inside the disk; a partial-exit case (29/61 raw
       samples off-disk) confirmed to produce exactly 2 bisected
       insertions and zero NaNs; a fully-outside case returns an empty
       polygon. Centroid tracks the already-validated central line
       (offset grows from ~0.1° to ~0.7° as the shape foreshortens near
       the disk edge, small relative to the shape's own several-degree
       extent); Calamocha sits inside the outline at its own local Max.
       `npm run test`: 61/61 (+6 new); `npm run check`: 0 errors/warnings.
     - ✅ **Fixed a real flicker near the terminator** (user-reported,
       visible only while animating through that region -- a single
       fixed instant, like every test above, couldn't catch it). Root
       cause: `pointAt`'s fixed-point iteration had no guard against its
       own `zeta1` going NaN mid-loop (possible even when `marginAt`'s
       cheaper un-iterated check said "inside", since the iterated/zeta-
       corrected shadow radius can differ enough right at the edge to
       push a q that `marginAt` approved past the ellipsoid) -- the NaN
       then propagated silently through the rest of the loop (the break
       condition never fires on NaN) into `ksiEtaToLatLon`, whose own
       `radical < 0` check *also* didn't catch a NaN radical (NaN
       comparisons are always false in JS), producing a non-null
       `{lat: NaN, lon: NaN}` point pushed straight into the rendered
       polygon -- corrupting the SVG on whichever frame happened to hit
       it, an intermittent glitch since which of the 60 sample angles
       triggers it shifts frame to frame as the geometry moves. Fixed
       three ways: `pointAt` now bails out (returns `null`) the instant
       its own iteration goes non-finite instead of limping through 10
       more NaN iterations; `ksiEtaToLatLon`'s check changed to
       `!(radical >= 0)` so it actually catches NaN too, not just
       negative; and the outer sweep now uses `pointAt`'s own
       (authoritative) result to decide per-angle validity instead of
       `marginAt`'s cheaper approximation, so a disagreement between the
       two can only ever shrink the visible arc (never sneak a bad point
       through) while still correctly triggering a bisected crossing
       insertion exactly where it happens. Added a permanent regression
       test sweeping every second through the whole terminator
       transition (well before onset through well past full disk-exit)
       checking for any non-finite point -- confirmed this test fails on
       the pre-fix code and passes after. `npm run test`: 62/62 (+1);
       `npm run check`: 0 errors/warnings.
     - ✅ **Spain tab given a fixed counterclockwise tilt** -- per direct
       request ("locking on one angular rotation value is sufficient",
       not a dynamic per-frame angle), applied via
       `spainProjection.angle()` *before* `fitExtent` so the fit itself
       accounts for the tilted content. First cut computed the exact
       bearing between `shadow-frames.json`'s two centralLine endpoints
       and used that to fully level the line (~40°) -- reported back as
       "too much" and over-engineered for what was asked ("a single
       fixed value would have been good"); dialed back to a plain
       `SPAIN_ROTATION_DEG = 30` (bumped from an initial 20 -- still just
       a plain constant, not re-derived), a modest tilt rather than a
       fully leveled line. `npm run check`: 0 errors/warnings.
     - ✅ **Penumbral outline support** -- `shadowOutlineAt` generalized
       with a `kind: 'umbra' | 'penumbra'` param selecting l1/tanf1 vs
       l2/tanf2 (the rest of the geometry only depends on the shadow
       axis's declination, identical either way), rather than a
       duplicated function. Wired into the Global tab as a second,
       much-lighter-opacity `<polygon>` underneath the umbra outline.
       Verified with a scratch sweep across the whole event window: no
       NaNs (reusing the same, already-proven terminator-bisection code
       path), and a plausible point count relative to the umbra outline
       given this event's near-terminator geometry throughout (this
       eclipse is sunset-limited even at greatest eclipse, so a
       meaningful arc of the much-larger penumbral circle already falls
       off the visible disk well before the umbra's own edge does).
     - ✅ **Global tab: real coastline + full-event N/S limits,
       replacing the crude hand-typed placeholders** -- per direct
       request ("the global map needs N/S limits, live penumbra
       outline, and better map data" plus "why is the centerline gray
       and blue now?"). Root cause of the "gray and blue" line: the tab
       was drawing *two* independent centerline datasets on top of each
       other -- a rough hand-typed full-path sketch (`.globalpath`,
       muted gray) alongside the precise but Spain-window-only
       `shadow-frames.json` line (`.pathline`, blue), since the precise
       data never covered the pre-Spain (Arctic/Siberia) portion of the
       path. Fixed at the source instead of just re-coloring: a new
       background-agent-generated `shadow-frames-global.json`
       (`tools/build-data/generate_shadow_frames_global.py`) auto-
       discovers the *whole* event's valid window (-1.058h to +0.633h
       from T0, ~101.5min, found via a coarse scan rather than assumed)
       at a coarser adaptive 10s step (553/529/574 points for central/
       north/south), with terminator-crossing points at *both* ends
       (unlike the Spain file's trailing-only one, since this window
       starts right where the umbra first touches the globe at all).
       Geography sanity-checked: starts in the Kara Sea/Russian Arctic,
       passes near the pole, over Iceland, ends in the western
       Mediterranean -- matches the real 2026-08-12 path. This one
       precise dataset now completely replaces the old dual rendering
       (`GLOBAL_CENTERLINE_PRE` deleted), plus gets its own N/S
       `limitline`s and shaded `pathband`, matching the Spain tab's
       visual language for the first time. Coastline: a new, much wider
       but more coarsely simplified `basemap-global.topojson`
       (`tools/build-data/basemap-global.mjs`, same `world-atlas`
       Natural Earth source as the Spain basemap, bbox `-65,45,135,90`,
       37KB) replaces the hand-typed Greenland/Iceland/Eurasia-coast
       polygons/polylines. The Global tab's projection itself is now a
       proper `d3-geo` custom raw projection (oblique stereographic,
       composed via `geoProjection()` + `.rotate()`/`.scale()`/
       `.translate()`) rather than a hand-rolled screen-space formula,
       so `geoPath` can drive it directly over the topojson feature the
       same way `spainProjection` already does -- verified byte-for-byte
       identical output to the old manual formula at five spot-check
       points before swapping it in. `npm run check`: 0 errors/
       warnings; `npm run test`: 62/62.
     - ✅ **Global map follow-up fixes**, all per direct feedback after
       the first cut above shipped:
       - **Scale.** `globalProjection` had a fixed hand-picked scale, so
         the actual content (the swept N/S limits band) occupied only a
         small area of the 200x200 viewport. Switched to
         `.fitExtent()` against the band itself (a small lon/lat ->
         GeoJSON Polygon helper, `llPolygon`) rather than the coastline
         -- the coastline's own bbox (Arctic Russia to Spain) is much
         wider than the band, so fitting to it left the band small in a
         corner. Verified: the band's on-screen bbox now touches the
         full padded height of the viewport.
       - **Terminator crossings bridged with a straight chord.** Where
         an outline exits and re-enters the visible disk, the polygon
         used to connect the two bisected crossing points directly --
         a straight line across the region that was actually off-disk,
         visibly wrong for the much larger penumbral outline (less
         obvious, but equally wrong, for the umbra outline too, being
         the same shared function). Per direct suggestion, fixed by
         treating the day/night terminator as a great circle (an
         excellent approximation) and inserting points along the great-
         circle arc between the two crossings (`greatCircleInterpolate`,
         16 segments) instead of leaving a straight gap. Getting this
         right without special-casing the q=0/2pi wraparound (a genuine
         edge case: the off-disk run can straddle that seam at some
         instants) needed `shadowOutlineAt`'s sweep restructured to
         start right at the beginning of an off-disk run and let q climb
         monotonically past 2pi rather than wrapping indices -- pointAt/
         marginAt are periodic in q (plain sin/cos), so this is exactly
         as valid as the original [0, 2pi) samples. Verified with a new
         test asserting every bridge point lies exactly on the great
         circle joining the two crossings (sum of its distances to both
         endpoints equals the endpoint-to-endpoint distance, monotonic
         along the arc) -- not just a point count. `npm run test`:
         63/63 (+1); `npm run check`: 0 errors/warnings.
       - **Stroke width and the centerline.** Per direct request, the
         Global tab's band/umbra/penumbra are now filled with no stroke
         at all (a `.globalFill` class, deliberately declared last in
         the stylesheet so it overrides `.umbraOutline`/
         `.penumbraOutline`'s own stroke for elements carrying both
         classes) -- at this small scale a 1px edge read as noise. The
         centerline and N/S limit lines are no longer drawn on this tab
         either (not needed once the band itself is filled);
         `GLOBAL_PATH_CENTER` (now unused for rendering) was removed
         rather than left as dead code.
       - **Broken-looking coastline.** Root cause: a custom
         `geoProjection()` has no default clip circle (unlike d3's own
         built-in azimuthal projections), so `geoPath` had no way to
         clip coastline rings passing near/beyond the antipodal point --
         classic symptom of a missing `.clipAngle()`, not a data problem
         (the "polygon closing" guess was reasonable but not it).
         Fixed with `.clipAngle(89.9)`. Verified: parsed the rendered
         path's `d` attribute directly -- no NaNs, max coordinate
         magnitude ~215 (previously could blow up much larger near the
         antipodal singularity), zero same-subpath jumps over 100px
         across all 65 subpaths (a proxy for "does any edge tear across
         the shape"). **Turned out to be real but insufficient** --
         reported back as still looking broken. The actual dominant
         bug was upstream, in the *data*, not the projection: Russia's
         unclipped polygon crosses the antimeridian (continuing past
         +180 as negative longitudes toward Alaska), and plain
         `mapshaper -clip bbox=...` mishandled that, inserting several
         spurious dead-straight edges thousands of km long at constant
         latitude (e.g. one ran from 67E to -65W along a single
         parallel) -- exactly the "spiky, self-intersecting-looking"
         mess reported, just not visible in the coordinate-jump/NaN
         checks above since these edges are individually well-formed,
         just geographically nonsensical. Found by scanning every ring
         for consecutive points with a >10deg longitude jump but <1deg
         latitude change; confirmed by testing `-clip bbox2=...`
         (mapshaper's alternate/experimental clip implementation)
         instead, which produces zero such jumps against many with the
         default. `tools/build-data/basemap-global.mjs` switched to
         `bbox2=`, plus `-filter-islands min-area=200km2` (flyspeck
         islands were otherwise indistinguishable noise at this map's
         small on-screen scale). Regenerated and reverified the same
         jump-scan directly against the live rendered `<path>` in the
         browser: 0 jumps, max coordinate magnitude ~165, 62 subpaths.
         **Still not it, reported back as "Eurasia is completely
         gone."** `bbox2=` turned out to have its own, different bug:
         it silently *dropped* Russia's mainland polygon entirely
         rather than clipping it (confirmed on the un-simplified,
         pre-filter-islands output too, so neither of those was
         responsible) -- swapping one failure mode for another, not a
         real fix. Chased the *actual* jump-artifact root cause much
         further: erasing a wedge around the true antimeridian
         (`\|lon\| > 150`) before clipping fixed the antimeridian jumps
         specifically, and did keep Eurasia this time, but a *second*,
         unrelated cluster of jumps remained around Novaya Zemlya/the
         Barents Sea (lat ~69-71.5, nowhere near the dateline) --
         present in `-clip bbox=`, `bbox2=`, and even a plain `-clip`
         against an explicit rectangle layer alike, so it wasn't a
         clip-flag problem at all. Isolated it by checking the *raw,
         unclipped* source: **mapshaper's clip code, in every variant
         tried, just doesn't handle Russia's Arctic coast cleanly
         against a bbox that partially contains it** -- not a fixable
         one-flag issue. Sidestepped entirely instead of chased
         further: simplify the *whole world* (no bbox clip at all) and
         let the already-correct, already-verified client-side
         `.clipAngle(89.9)` (from the earlier fix above) do all the
         regional clipping at render time, the same way it already
         correctly handles everything else. Zero jumps, geographically
         and in the live rendered path, at every simplify level tried;
         landed on 15% (98KB, still a reasonable bundle addition).
         `tools/build-data/basemap-global.mjs` simplified down to just
         `-target land -filter-islands ... -simplify ...` -- no clip
         step at all, and the comment there records the dead ends so
         the next person doesn't retry them.
       - **Stroke.** Per direct request, `.coast` (shared with the
         Spain tab, so both got it) changed from the themed `--line`
         gray at 1px to a plain black 0.5px -- narrower and higher-
         contrast, matching real reference-map coastline convention
         better than the soft themed gray did.
       - **Band transparency.** `.pathband`/`.globalBand` (the swept
         umbral corridor across the whole event, as opposed to the
         instantaneous umbra/penumbra outlines which already had their
         own fill-opacity) had no opacity set at all -- a fully opaque
         wash hiding the coastline underneath it, on both tabs. Added
         `fill-opacity: 0.35` to both.
     - ✅ **Spain tab: cities, major roads, and a widened map area**, per
       direct request. The bbox (`basemap.mjs`'s `BBOX`) was Iberia-only
       and cut off right at the Pyrenees; widened to
       `-10.5,35,9.5,51.5` -- all of mainland France plus neighbor
       context, not just a sliver of it. New `cities.json` (76 cities,
       `pop_max >= 300,000` within that bbox -- every major Spanish/
       French/Portuguese city plus reasonable context, not a solid mass
       of dots on a 280x200 panel) and `roads.topojson` ("Major Highway"
       only, not the much denser secondary/local road classes) are both
       from Natural Earth's 1:10m cultural vectors -- neither is in the
       already-installed `world-atlas` npm package (confirmed by
       listing its actual contents rather than assuming), so both are
       fetched directly: cities via a community GeoJSON mirror
       (`github.com/nvkelso/natural-earth-vector`), roads via Natural
       Earth's own shapefile CDN, following the exact same
       download-once-into-`.cache`/clip/simplify/bundle pattern as
       `basemap.mjs` and `stars.mjs` already use. Both public domain, no
       attribution required (confirmed directly against Natural Earth's
       own terms-of-use, not assumed from the `world-atlas` ISC
       precedent). No labels on either yet -- explicitly a near-term
       follow-up, not this pass; `name` is kept in `cities.json` now so
       adding labels later doesn't need a re-fetch. Rendered as a thin
       muted line layer (roads) and small muted dots (cities) between
       the coastline and the eclipse-specific overlays (umbra band/path/
       outline), so the reference detail reads as context, not
       competing with the actual point of the map. Data source research
       (confirming what's actually in `world-atlas`, finding working
       current download URLs, confirming licenses) done via a parallel
       research workflow rather than guessed at; the widened-bbox
       regeneration surfaced one legitimate test update needed
       (`basemap.test.ts`'s exact expected country list -- widening the
       bbox correctly pulls in Belgium/Germany/UK/etc. too, not a
       regression). `npm run test`: 63/63; `npm run check`: 0
       errors/warnings.
     - ✅ **Spain zoom/framing rework, a second roads tier, and ocean
       color on both tabs**, per direct request:
       - **Zoom.** Previously fit the whole basemap bbox (Iberia+France);
         now fit to the umbra band itself, scaled so the viewport height
         is ~`SPAIN_BAND_TO_HEIGHT` (4) times the band's own rotated
         north-south width -- d3's `fitHeight()` gives the scale that
         makes the band fill the *entire* viewport height, dividing by 4
         scales that back down in one step (a plain `fitExtent` on both
         dimensions would've been width-limited instead, since the
         band's east-west length dwarfs its width). Verified by reading
         the rendered `.pathband`'s actual `getBBox()`: height exactly
         50 (=200/4), vertically centered (y=75, panel height 200).
       - **Right-justified, not centered.** Translate is chosen (not
         fit) so the band's rightmost point -- the Balearics end, closer
         to the sunset cusp -- sits `SPAIN_RIGHT_MARGIN` (8) inside the
         right edge; confirmed via the same `getBBox()` read (x+w=272,
         panel width 280). Combined with changing the Spain `<svg>`'s
         `preserveAspectRatio` from `xMidYMid` to `xMaxYMid meet`, a
         vertically-shrunk panel now only grows the empty margin on the
         *left* -- verified by reading `getScreenCTM()`-mapped screen
         positions of the viewBox's left/right edges at two different
         panel heights: the right edge stayed pinned to the container's
         right edge in both cases, while the left-side gap grew from
         266px to 487px as the panel was shortened from 265px to 107px
         tall.
       - **Second roads tier.** `tools/build-data/roads.mjs` now also
         writes `roads-minor.topojson` (Natural Earth's "Secondary
         Highway" `type`, one tier below the existing "Major Highway"
         layer), rendered with the same stroke-width but much lower
         stroke-opacity (`.roads-minor`) so it reads as dimmer background
         context under the crisper major-road layer, not competing with
         it.
       - **Ocean color, both tabs.** `.mapzone`'s background (which
         shows through everywhere `.coast`'s land fill doesn't cover --
         there's no separate ocean layer) changed from the neutral
         `--zone` gray to a new light-blue `--ocean` token. Deliberately
         just a background-color swap, not a real ocean polygon layer --
         per direct request, cheap now, revisit later; it also has the
         side benefit of not looking "broken" if the tighter Spain zoom
         ever shows area outside `basemap.topojson`'s own loaded bbox,
         since a uniform blue background reads as plausible open ocean
         either way.
     - ✅ **Global tab re-rotated and re-framed around greatest eclipse**,
       per direct request ("rotated so the umbra line is horizontal at
       greatest eclipse... maybe 70 degrees counter clockwise", "penumbra
       upper edge (the terminator line) at the top... umbra line's
       lowermost part being roughly greatest eclipse at the bottom with a
       large margin"):
       - **Rotation.** The user's ~70° estimate was a starting point, not
         computed precisely -- did the real computation instead of
         guessing further: took two real `shadow-frames-global.json`
         central-line samples bracketing greatest eclipse (GE) and
         projected them (rotate-only, angle=0) to get the local screen
         bearing there, cross-checked independently against the
         standard great-circle initial-bearing formula on the same two
         points (169.5° vs 169.7° clockwise-from-north -- agree to
         0.2°, confirming the projection preserves bearing correctly, as
         an azimuthal projection centered on GE should). Required
         rotation to level that bearing: ~79.7°, not 70° -- applied via
         the same generic `.angle()` post-projection rotation Spain's
         `SPAIN_ROTATION_DEG` already uses (confirmed d3-geo's `.angle()`
         is independent of `.rotate()`'s own gamma and works identically
         on a custom `geoProjection()`, not just the built-in ones), then
         rounded to a clean `GLOBAL_ROTATION_DEG = 80` rather than kept
         at full precision (same "single fixed value" convention as
         Spain's). Verified in-browser (not just in the offline
         calculation) by replicating the exact same rotate+angle math
         against the two bracketing points: residual tilt from
         horizontal, 0.29° -- visually indistinguishable from level.
       - **Framing.** Discovered (by projecting the *entire* central
         line with the new rotation and reading off the min/max screen-y)
         that GE ends up almost exactly the lowest on-screen point of
         the *whole* event -- both the Arctic start and the Spain end
         curve back up above it. That makes GE a natural bottom anchor
         and `northLimitTerminatorStart`/`southLimitTerminatorStart`
         (where the umbra first grazes the day/night terminator, already
         in `shadow-frames-global.json`) a natural top anchor -- "the
         terminator line" from the request. Replaced the old
         fit-the-whole-band `fitExtent` with an explicit scale/translate
         solve: `GLOBAL_TOP_MARGIN` (16, modest, "some margin") above
         the terminator points, `GLOBAL_BOTTOM_MARGIN` (56, "quite
         large") below GE. One direct consequence, not a bug: the far
         (Spain/Balearics) end of the swept band now renders *above* the
         visible top edge, off-frame -- this tab now shows "Arctic
         terminator down to greatest eclipse" specifically, leaving the
         already-redundant Spain-specific detail to the Spain tab.
         Verified by reading the rendered `.gemarker`'s actual `cx`/`cy`
         (100, 144 -- horizontally centered, exactly `200 - 56`) and by
         re-deriving the terminator points' screen position with the
         same formula (one landed at exactly y=16, the other safely
         inside at y≈30.6, both within the horizontal frame). Also
         confirmed no coastline/data regression: `.coast`'s path data
         still non-empty and covers the expected huge (whole-world)
         bounding box, same as before.
       `npm run check`: 0 errors/warnings; `npm run test`: 63/63.
   - ✅ **Real, live obscuration replacing the Magnitude/Obscuration
     placeholders** -- per direct request, Magnitude itself is dropped
     (not interesting), replaced with two obscuration numbers instead,
     both derived entirely from the same L1 (penumbral)/L2 (umbral)
     shadow radii and observer-to-axis distance `m` the C1-C4 root-finder
     already computes -- no separate ephemeris/angular-radius lookup
     needed (`eclipse/localCircumstances.ts`'s new `obscurationAt`).
     Classical relationship: `L1 = r_sun + r_moon`, `L2 = r_sun - r_moon`
     (negative here since the Moon's disk is bigger), so
     `r_sun=(L1+L2)/2`, `r_moon=(L1-L2)/2` solve out of the sum/
     difference pair. **Linear** (`(L1-m)/(L1+L2)`, what "magnitude"
     already measured, just renamed/reframed as a %) genuinely exceeds
     100% at/near mid-totality since the Moon's disk is bigger than the
     Sun's -- clamped to [0,1] for display per direct request. **Area**
     (the real "% of the Sun's disk actually hidden") uses the standard
     two-circle intersection-area formula, with `m <= |L2|` (fully in
     the umbra, area=1 exactly) the same condition the C2/C3 root-finder
     already uses. Both are **live** (a new `stores/obscuration.ts`
     keyed on `[observer, effectiveTime]`, unlike the fixed-per-observer
     `localCircumstances` store), per direct request. Caught and fixed a
     real bug while verifying: far from the event (e.g. real "now",
     weeks before 2026-08-12), the Besselian cubic polynomial is wildly
     extrapolated hundreds of hours outside its valid window, and `m`
     can come out arbitrarily small by coincidence -- without a guard
     this showed a clamped "100% obscured" on an ordinary day, not just
     an unclamped garbage number. Fixed with a `VALID_WINDOW_HOURS = 4`
     domain guard returning exactly `{linear:0, area:0}` outside it
     (contact-time searches don't have this problem, being bounded root-
     finds anchored near T0 regardless of "now" -- this is a plain
     function evaluation with no such bound of its own). Verified
     against known values: 0%/0% at C1 and C4 exactly, 100%/100% at C2
     and C3, 101.6%/100% (unclamped/clamped) at Max, and area
     legitimately lagging linear during the partial phase (38.6% vs.
     49.2% at the C1-C2 midpoint) -- matches known real eclipse
     behavior, not just internally self-consistent numbers. `npm run
     test`: 61/61; `npm run check`: 0 errors/warnings.
   - ✅ **Real per-event Sun alt/az in the contacts timetable**, replacing
     the "--" stub, plus live Sun alt/az in the lower circumstances row
     (the "Sun az" provisional placeholder is gone -- no more a
     `†`-flagged value there). `skyView.ts`'s per-tick `bodyPosition`
     closure extracted into a standalone exported `bodyPositionAt(date,
     astroObserver, body, radius)` plus a `sunAltAzAt(date, lat, lon,
     elevationM)` convenience wrapper, so each table row can compute the
     Sun's position at *its own* timestamp (C1/C2/Max/C3/C4/Sunset) using
     the exact same Equator/Horizon math the live store uses, instead of
     a second implementation. Sunset's alt is no longer hardcoded to a
     literal "0°" -- computed the same uniform way as every other row,
     which surfaces a small (~-0.2°) real discrepancy between Horizon()'s
     'normal' refraction model and SearchRiseSet's own fixed-34' one
     (already documented above) rather than papering over it. Verified
     in-browser: table shows e.g. C1 16.1°/276°, Sunset -0.2°/290°; live
     row shows Sun alt/az tracking the clock. `npm run check`: 0
     errors/warnings; `npm run test`: 62/62.
   - ✅ **Global circumstances toggle** (§9's "Eclipse Times" feature) --
     per direct request, built as data (Python/eclipse-calc) + UI in
     parallel background/foreground tracks rather than sequentially.
     - ✅ **Data**: `tools/build-data/generate_eclipse_times.py` ->
       `app/src/data/eclipse-times.json`, the standard 16-row global
       "Eclipse Times" table (P1/U1/C1/U2/GE/U3/C2/U4/P4 plus the
       extreme N/S umbral/penumbral limit points) every eclipse
       calculator publishes -- whole-event facts, not tied to any one
       observer, so precomputed like the central line/N-S limits, not
       computed client-side. Investigated a real shortcut first (caught
       by direct question -- "isn't the N/S extrema just the terminator
       points you already done?"): confirmed by fetching ytliu.epizy.com's
       own published table for this exact eclipse and comparing
       coordinates directly that C1/C2/NU2/SU2 (4 of 16 rows) are
       exactly `shadow-frames-global.json`'s existing
       `centralLineTerminatorStart/End`/`northLimitTerminatorEnd`/
       `southLimitTerminatorEnd` -- re-exported, not recomputed. The
       *early* pair (SU1/NU1) looked like the same shortcut but wasn't:
       verified directly against ytliu and found 0.68-0.69&deg;
       (~75-77km) off in latitude despite agreeing in time/longitude --
       traced to a genuine `eclipse_calc.shadow.shadow_limits` tangent-
       search instability in the first 30-40s after it starts
       converging this close to this event's extreme near-polar
       (75-77&deg;N), terminator-limited start (confirmed via a fine
       time-grid probe plus a third independent cross-check method, not
       just distrusted on suspicion). Penumbral limits (SP1/SP2) confirmed
       genuinely non-convergent too (a risk PLAN.md already flagged).
       P1/U1/U2/U3/U4/P4 turned out to already exist accurately in
       eclipse-calc's `terminator.terminator_events()` (~0.005&deg;/~1s
       off ytliu) -- no new eclipse-calc code needed, better than the
       nested-optimizer contact search sketched in the brief. GE is a
       plain 1D minimization of shadow-axis distance from Earth's
       center. Net: 11 of 16 rows shipped (P1,U1,C1,U2,GE,U3,NU2,C2,
       SU2,U4,P4), 5 omitted with specific documented reasons (CM
       deferred by direct request; SP1/SU1/NU1/SP2 genuine convergence
       gaps) in the JSON's own `omitted` array and `NOTICE.md`, not
       silently dropped or forced to a wrong number. Every shipped row
       verified against ytliu to within ~3s / ~0.06&deg;.
     - ✅ **UI**: `ContactsPanel.svelte` gained a "Show/hide global
       events" toggle (off by default) that interleaves the 15 (11
       real + none faked) events chronologically into the *same* table
       as the local C1-C4/Max/Sunset rows, not a separate fullscreen
       view as originally sketched in §9 -- 11 extra rows didn't
       warrant one. Local rows stand out against interleaved global
       ones via a colored left edge (`--cline` blue) plus full-contrast
       text, deliberately a different mechanism from the existing
       `.next` accent-bg "what's about to happen" highlight so the two
       indicators don't visually collide on the same row; "next"
       itself still only ever tracks the next *local* row even with
       globals interleaved, since that's what it's always meant.
       Global rows show a lat/lon subtext under the event name instead
       of Alt/Az (not meaningful for a point elsewhere on Earth) and a
       muted/smaller treatment. `c1`/`c2` in the data mean the *global*
       central line's begin/end, a real naming collision with this
       table's own *local* C1/C2 (this observer's contacts) --
       relabeled CL1/CL2 for display only, every other key already
       matches its own standard short code (U1, GE, etc.). The 5
       omitted rows are surfaced as a small "5 omitted" badge (not
       silently missing) with the JSON's own per-event reasons in a
       title tooltip. Built against a placeholder file (transcribed
       from the same ytliu numbers used to verify the real data) while
       the Python side was still running in the background, swapped
       for the real file the moment it landed -- schemas matched
       exactly, zero rework needed. `npm run check`: 0 errors/warnings;
       `npm run test`: 63/63.
     - ✅ **Scrollable table.** The panel was previously deliberately
       scroll-free (local-only view tops out at 6 rows, fits any
       reasonable pane size) -- with global events interleaved it can
       run to ~17 rows, more than the panel has room for, and
       `.pane`'s own `overflow: hidden` (App.svelte) was silently
       clipping the overflow instead of showing it. Wrapped just the
       `<table>` in a scrolling `.tablewrap` (`.contacts` restructured
       into a flex column: toggle header / scrollable table / circ
       strip, header and strip both `flex-shrink: 0` so they stay put)
       -- the table-only scroll needed `min-height: 0` on `.tablewrap`
       to actually take effect (a flex child won't shrink below its own
       content size otherwise, silently defeating the scroll). Column
       headers `position: sticky` within the scroll area. Verified:
       local-only view still needs no scroll (content fits exactly);
       with global events on, `scrollHeight` (585px) exceeds
       `clientHeight` (200px) and the header stays pinned at
       `scrollTop: 300`.
     - ✅ **Past/next reacted to local rows only.** `nextKey` was
       computed from `rows` (local-only) even with global events
       interleaved, per an explicit original design choice ("next"
       answers "what's coming up for *me*") -- reported back as wrong:
       global rows should react to the same past/next/future state as
       local ones instead of just sitting there inert. Moved `nextKey`
       to derive from `displayRows` (whatever's actually shown) instead
       of always `rows`, and added a `.past` class (any row, local or
       global, whose own timestamp is already behind `effectiveTime`,
       opacity 0.5) which didn't exist at all before -- there had been
       no visual distinction between an already-happened row and a
       future one, local or global. Verified in-browser: with global
       events on, `next` now correctly lands on P1 (a global row, and
       chronologically the very first event of the whole eclipse) --
       previously it would have incorrectly stayed on local C1 even
       though P1 is both earlier and still in the future. `.past`
       itself wasn't re-verified live (needs sim mode at an in-event
       instant, and this session's well-documented synthetic-pointer
       sim-mode flakiness blocked that specific check) -- the class
       binding is simple/type-checked and low-risk, but flagged here as
       not independently confirmed the way the `next`-crosses-types fix
       was.
     - ✅ **Trimmed to the standard contact-time events only**, per
       direct request -- P1/P4, U1-U4, GE (7 rows), dropping the
       central-line begin/end (CL1/CL2) and extreme N/S-limit points
       (NU2/SU2) that were shown before. Filtered in the display layer
       only (`GLOBAL_KEYS`), not the data -- `eclipse-times.json` still
       carries all 11 computed rows, just not all of them are shown in
       *this* table. Separately, a user question about why NU1/SU1/SP1
       don't appear at all (the "5 omitted" gaps, unrelated to this
       trim) came up first -- confirmed the current behavior (leave
       genuinely omitted rather than show a known-~75km-off value) was
       already the wanted one, no change needed there.
     - ✅ **Global toggle moved into the bottom ribbon** ("Global",
       next to Duration/Obsc./Sun alt/az), dropping the separate
       `.tablehead` row above the table entirely -- per direct request.
       Surfaced and fixed a real layout bug along the way: shrinking the
       panel vertically left dead space between the table and the ribbon
       that didn't get resized away, while row text/padding had already
       started shrinking. Root cause -- `--tscale` (the shrink-to-fit
       factor) was keyed off the *whole pane's* height against a 340px
       threshold tuned for the old tablehead+table+circ composition, so
       it started shrinking rows before `tablewrap`'s own leftover slack
       (unfilled flex space below the rows) had actually run out. Fixed
       by decoupling: the table (`table`/`td`/`th`) now renders at a
       fixed, un-scaled size and relies purely on `tablewrap`'s existing
       scroll for genuine overflow, while `--tscale` (now keyed off a
       200px threshold, matched to the much shorter ribbon+padding alone)
       only shrinks the chrome around it. Verified by reading computed
       layout geometry directly (`getBoundingClientRect`/`--tscale`) at
       several simulated pane heights rather than by eye: at 298px, dead
       space (26px) sat below full-size rows with `--tscale: 1`; shrunk
       to 208px, the dead space was gone and the table scrolled (rows
       still full-size, not shrunk); shrunk further to 181px (below the
       200px chrome threshold), only then did `--tscale` start easing
       down (0.91) and the ribbon itself shrink slightly. (Also: the
       in-browser click on the relocated toggle button was flaky via the
       automated `computer` tool -- the same well-documented synthetic-
       pointer unreliability as this session's Sim-mode checks, not a
       code issue; a real `.click()` dispatch after a fresh reload
       toggled correctly and immediately.)
     - ✅ **Follow-up correction, same ribbon:** two more direct requests
       -- move the "Global" button to the ribbon's right edge (wrapped
       it with the "N omitted" badge in a `.globalgroup` div, pinned via
       `margin-left: auto`; needed the higher-specificity `.circ
       .globalgroup` selector, not bare `.globalgroup`, to escape
       `.circ div`'s column-flex/2px-gap rule) -- and undo the "table
       never shrinks, always scrolls" trade-off from the previous entry
       for the *local-only* view specifically: with global events off
       there are at most ~6 rows, which can always be shrunk to fit
       instead of ever needing a scrollbar, so a scrollbar there reads
       as a bug, not a legitimate space constraint. Replaced the fixed
       table font-size/padding with a new `--tscale-table` factor on
       `tablewrap` (`min(1, cqh / natural-content-height)`, no floor) --
       `natural-content-height` is computed in the component from the
       actual currently-displayed row count/types (measured header/local-
       row/global-row heights: 28/32/46px at scale 1) and passed down as
       an inline `--natural-h` custom property, since a container query
       can't measure a sibling's content size directly. With global
       events on (`.tablewrap.crowded`, up to ~17 rows of two different
       heights), full shrink-to-fit would make text illegibly small on
       anything but a tall panel, so that variant keeps the old 0.4 floor
       and a scrollbar below it -- deliberately the one case where
       scrolling is still correct. Hit one rounding gotcha along the way:
       row `border-bottom: 1px` doesn't shrink with `--tscale-table`
       (fractional borders round inconsistently across browsers), so at
       scale<1 the real rendered row height comes out a little taller
       than a purely linear estimate -- enough (~2px at a 6-row table) to
       trip the "never" promise right at the boundary. Fixed by padding
       `natural-content-height` with a small per-row-boundary buffer.
       Verified, not just by eye, by resizing the pane programmatically
       across its full range (298px default down to the hard 140px
       floor) and reading `tablewrap.scrollHeight` vs `clientHeight` at
       each step: zero scroll in the local-only view at every height
       tested, including 140px exactly; with global events on, the same
       sweep shows no scroll at 298px (still fits, floored-but-not-
       maxed-out) and correctly picks up a scrollbar at 220px and 140px
       once the floor's reached and content genuinely no longer fits.
   - 🟡 Wire SkyPanel to astronomy-engine (Sun/Moon/planets/stars from
     `stars.json`) against `clock` + `observer`:
     - ✅ New `stores/skyView.ts` derived store: real Sun/Moon alt-az
       (`Equator`+`Horizon`, refraction `"normal"`) and real star alt-az
       for the whole `stars.json` catalog (mag<3, 174 stars) -- catalog
       J2000 ra/dec fed to `Horizon()` directly rather than precessed to
       date first, a sub-degree error well below what this flat,
       schematic view needs. Sanity-checked against the plan's own
       spot-checked Calamocha reference: computed Sun alt/az at Max
       (5.938°/284.57°) matches to 3 decimal places, and Sun/Moon
       positions coincide almost exactly at that instant (as expected --
       that's what totality means). `npm run check`: 0 errors/warnings.
     - ✅ **All-sky (dome) view wired to real data**, replacing the
       placeholder `SUN_ALT`/`SUN_AZ`/fixed star scatter -- same polar
       projection formula as before (zenith->center, horizon->edge),
       now fed real per-object alt/az; stars below the horizon are
       filtered out, Sun/Moon hidden (not just off-dome) when below the
       horizon; star dot size now scales with real magnitude (brighter
       = bigger), not tinted by color index yet. `npm run test`: 55/55;
       `npm run check`: 0 errors/warnings.
     - ⬜ **Wide view still the mock's stub** -- it isn't alt-az-based
       at all yet (fixed pixel offsets), unlike All-sky's direct
       polar-projection reuse. Needs its own design: a sun-centered
       tangent-plane projection (narrow azimuth window around the Sun's
       current azimuth, altitude vertical) rather than the whole-dome
       formula -- a real follow-up, not a trivial plug-in.
     - ✅ **`CountdownPanel`'s flat Sun/Moon schematic (§9) is real too**,
       not just the All-sky dome -- was a fixed, always-identical pair
       of circles regardless of actual eclipse phase. `skyView.ts`
       extended with `angularRadiusDeg` (physical radius / topocentric
       `Equator().dist` -- already observer-corrected, not geocentric,
       which matters for the Moon) and `moonSunSeparationDeg` (spherical
       law of cosines on alt-az). Deliberately plain two-body geometry,
       *not* astronomy-engine's own `SearchLocalSolarEclipse` -- this
       project's one source of truth for eclipse *timing* is the
       Besselian/eclipse-calc pipeline (§14 #4); a second independent
       "when does the eclipse happen" source wasn't wanted even from a
       library that happens to offer one (caught before implementing,
       per project-owner pushback). Sun pinned at a fixed pixel radius;
       Moon's radius and the Sun-Moon offset both scale off the same
       real degrees-per-pixel factor, clamped to stay near the Sun
       on-canvas when the true offset would be way outside the viewBox
       (i.e. most of the time, outside the ~2h event window). Verified
       at three real phases: far from any contact today (moon clamped
       to the canvas edge, no overlap), mid-partial-phase (partial,
       physically-consistent overlap), and simulated Max (moon centered
       within half a pixel of the Sun, r=45.44 vs Sun's 44 -- matching
       the mock's original hand-picked placeholder, 45.3, almost
       exactly). `npm run test`: 55/55; `npm run check`: 0
       errors/warnings.
     - ✅ **CountdownPanel layout fixes** (four issues found once the
       schematic went real): (1) the Moon-offset clamp only bounded the
       *center*, not the rendered disk (offset + Moon's own radius), so
       near C1/C4 the disk could extend past the SVG viewBox and get
       hard-clipped by its default overflow behavior -- fixed by
       clamping `offset + moonRPx <= viewBoxHalf - margin`, computed
       fresh each frame from the current Moon radius, and enlarged the
       viewBox (120→160) for more travel room. (2) crossing into/out of
       the C2-Max dual-line window changed `.numwrap`'s natural height,
       shifting the SVG below it (parent flex column re-centers) --
       fixed with a `min-height` on `.numwrap` reserved for the
       dual-stacked worst case unconditionally, so single/dual/row/
       stacked switches never change that box's height. (3) the
       side-by-side-vs-stacked choice for the dual pair was a static
       `@container (min-width: 500px)` rule that didn't know the
       labels' actual rendered text width, clipping before the switch
       -- replaced with a real measurement (label widths + gap vs.
       available width) via a `ResizeObserver` on both labels and the
       outer `.countdown` box (not `.numwrap` itself, which shrinks to
       fit its own content in the center-aligned flex column and so
       can never observe how much room is *actually* available --
       caught this by testing the fix and finding row-mode could never
       trigger). A ResizeObserver (not a tick-driven re-measure) is
       required because the panel can sit paused for a long time and a
       splitter-drag while paused must still flip back to stacked
       immediately, not wait for the next countdown tick. (4) trimmed
       `.countdown`'s padding/gap and let the SVG grow via `flex: 1 1
       auto; width/height: 100%` instead of a fixed-ceiling `cqw`/`cqh`
       formula, so the figure and text fill the panel with minimal
       margin. Verified via direct DOM measurement (`getBoundingClientRect`
       on the Moon disk vs. viewBox bounds, `.numwrap` height across
       single/dual, row/stacked at several panel widths including the
       exact width that used to clip) rather than screenshots, since
       the in-app browser's screenshot tool has been non-functional all
       session. `npm run test`: 55/55; `npm run check`: 0
       errors/warnings.
     - ✅ **CountdownPanel schematic geometry, round 2** -- the layout
       fix above still clamped the Moon's offset to fit its whole disk
       inside the viewBox, at a threshold (`viewBoxHalf - moonRPx -
       margin`) far smaller than the true first/last-contact separation
       (`sunRPx + moonRPx`). Symptom (user-reported): the Moon appeared
       frozen/always-overlapping for almost the entire C1-C4 window,
       only showing real motion for a few minutes around Max. First
       fix: changed the clamp to the exact external-tangency distance
       and enlarged the viewBox (120→340) to fit it without clipping --
       verified this made the Moon move continuously and correctly
       across the *whole* C1-C4 window (an independent adversarial
       review cross-checked the tangent-plane-vs-spherical approximation
       and the worst-case Moon-radius/viewBox math and confirmed both
       hold, with the approximation error negligible at this event's
       real low Sun altitude). But blowing up the viewBox to fit the
       worst case shrank the Sun to a small fraction of the panel --
       "way too small" (user feedback). Second fix, per direct user
       instruction ("why can't you just make the sun a fixed size and
       render the moon where it belongs ephemerides-wise -- moon
       doesn't need to be completely visible, as long as it's not ugly
       clipped and doesn't block the countdown text"): removed the
       clamp entirely. Sun radius and viewBox reverted to the original
       mock-matching scale (`SUN_R_PX=44`, viewBox 120, ratio 0.73 --
       a prominently-sized Sun again), and the Moon now always renders
       at its true scaled ephemeris position, however far that is.
       Outside the ~2h event window (i.e. most of the time) the Moon is
       simply off the Sun entirely and isn't drawn -- the physically
       honest picture, not something to hide behind a clamp. Near
       C1/C4 the Moon's disk can partially exceed the viewBox and gets
       clipped by the SVG's own box (explicit `overflow: hidden`,
       previously implicit) -- a partial-circle/crescent peeking in
       from the edge, not a distortion of its position. That box is a
       separate flex child below `.numwrap`, so this clipping can never
       cover the countdown text (verified: clean 4px gap between
       `.numwrap`'s bottom and the svg's top at every panel width
       tried). `npm run test`: 55/55; `npm run check`: 0 errors/warnings.
     - ✅ **TopBar clock didn't track sim mode** (user-reported: "the
       now timestamp in the upper right corner doesn't update in sim
       mode. It needs to. It should say SIM over there when in sim
       mode") -- it read the plain `now` store (always real wall clock)
       instead of `effectiveTime` (`clock`+`now` derived, tracks
       `simTimeMs` while in sim mode). Swapped the import and added a
       `{#if $clock.mode === 'sim'}SIM{/if}` badge next to the CEST/UT
       spans. Verified in-browser: Live mode shows the real ticking
       clock with no badge; entering Sim mode immediately shows the SIM
       badge and jumps the displayed time to the sim clock's instant
       (matched `freshSimStartMs()` exactly, C2-90s, on entry).
     - ✅ **CountdownPanel schematic colored in** -- per direct request,
       departs from the flat-monochrome-outline treatment used
       elsewhere (SkyPanel's dome/wide views): both circles are now
       fill-only (no stroke/border), Sun `#f6c445` (yellow-gold), Moon
       `#000000` (black), on a dark navy sky background. Moved the
       background from just the svg to `.countdown` itself (the shared
       parent of both the text and the graphic) after a follow-up
       request -- lightened to `#173a6e` (was `#0d1b3a`, "too dark")
       and now covers the countdown text too, with the text set to
       white; the svg itself is transparent and just shows the parent
       background through. Verified via computed style in-browser.
       `npm run test`: 55/55; `npm run check`: 0 errors/warnings.
     - ✅ **Root-caused and fixed the Sun/Moon schematic's C2/C3 timing
       gap** (user-reported: Sun pixels vanishing before C2, reappearing
       before C3, during official totality) -- NOT refraction (checked
       and ruled out: differential refraction between Sun and Moon near
       contact is only ~0.06-0.24", since they sit within ~0.003° of
       each other in altitude), NOT a frame/equinox mismatch (both
       pipelines correctly target apparent, true-equator-of-date), and
       NOT elevation (a real, separate bug -- see below -- but it's 0
       identically in both pipelines, so it can't be the *differential*
       cause). The real cause: astronomy-engine's `Equator()`/`Horizon()`
       calls (stores/skyView.ts) convert the given UTC instant to
       Terrestrial Time using the library's own built-in ΔT model
       (`DeltaT_EspenakMeeus`, a 2006 polynomial giving ~75.4s for
       2026-08-12 -- the same NASA-SEdata-era figure already rejected
       for the Besselian side), while the Besselian/eclipse-calc
       pipeline uses a locked 69.1s (matching Skyfield's real ~68.78s).
       Both pipelines are handed the *same* UTC instant but silently
       evaluate it at TT epochs ~6.3s apart -- and since the Moon moves
       ~0.55"/s across the sky, that alone displaces its computed
       position by several arcseconds. This matters here specifically
       because the eclipse is razor-thin at Calamocha: true Sun-Moon
       separation at C2 is 30.76" against a full-coverage threshold of
       ~31.10" -- a margin of just 0.34". Fixed via astronomy-engine's
       own public `SetDeltaTFunction` override (`eclipse/
       astronomyEngineDeltaT.ts`, a side-effect module imported by both
       skyView.ts and stores/localCircumstances.ts, pointed at the same
       `deltaTSeconds` constant the Besselian pipeline uses -- one
       shared source, not a second hardcoded 69.1). Verified
       numerically (a temporary scratch test, deleted after): closes
       ~70% of the gap (separation-vs-threshold error at C2: -6.05" ->
       -2.50"). The residual ~2.5" comes from astronomy-engine's own
       lower-precision analytic position series (a truncated VSOP87 Sun
       and a 1954-era lunar theory) versus eclipse-calc's full JPL
       DE440s numerical ephemeris via Skyfield -- inherent to the
       library, not fixable by parameter tuning; would need a different/
       heavier ephemeris source to close further, not pursued (per
       explicit user direction against chasing more library precision).
       An earlier attempt to paper over the same symptom by clamping the
       schematic to the official [C2,C3] window was tried and reverted
       -- it produced a visible abrupt snap-to-center/release, not the
       smooth motion wanted; this ΔT fix addresses the actual root
       cause instead. `npm run test`: 55/55; `npm run check`: 0
       errors/warnings.
     - 💡 **Possible future upgrade** (not started, not currently
       warranted): the ~2.5" residual left after the ΔT fix comes from
       astronomy-engine's own lower-precision analytic Sun/Moon series,
       not from anything fixable by more tuning. The strongest
       available fix would follow the same pattern already used for
       `shadow-frames.json`: have `tools/build-data/` fit a small
       Chebyshev polynomial to Skyfield/DE440s Sun+Moon positions over
       just the ~2h event window (a few KB, not a full SPICE kernel),
       ship it as bundled JSON, and have the client evaluate the
       polynomial instead of calling astronomy-engine for the
       schematic -- this would make the schematic agree with the
       Besselian times *exactly*, since it's the same ephemeris source.
       Limitation: only valid for the specific observer it was
       generated for, so arbitrary map-click locations would still need
       a fallback (the current ΔT-corrected astronomy-engine path).
       Worth revisiting only if the residual ever becomes visually
       noticeable again.
     - ✅ **Horizon line added to the countdown schematic** -- a solid
       line with a semi-transparent "ground" fill below it (painted
       *over* the Sun/Moon disks, not behind, so a setting Sun visibly
       sinks behind it rather than being hard-clipped), rising as sim
       time approaches and passes sunset. Getting the crossing moment
       to actually line up with the official Sunset time (shown
       elsewhere in ContactsPanel/TimeBar) took real care: the Sun's
       disk is drawn using its *refracted* altitude (`sun.altitude`,
       astronomy-engine's `'normal'` Horizon() mode, Saemundsson's
       altitude-dependent formula), but `SearchRiseSet` (which computes
       the official Sunset) uses a completely different, fixed ~34'
       refraction *constant* (scaled by atmospheric density at the
       observer's elevation) applied to the Sun's *unrefracted*
       altitude. Those two refraction models measurably disagree at
       these shallow angles (~37' vs 34' at this event's sunset, an
       ~8.5px difference in the schematic's scale) -- an initial
       version that reused the refracted `sun.altitude` for the horizon
       line crossed the Sun's edge about a second-and-a-half off from
       the real Sunset instant. Fixed by adding `altitudeTrueDeg`
       (unrefracted) to `skyView.ts`'s `BodyPosition` and a
       `horizonDepressionDeg` field computed with the exact same
       constant/`Atmosphere()` density scaling `SearchRiseSet` uses
       internally, then positioning the horizon line at
       `sun.altitudeTrueDeg + horizonDepressionDeg` in the same
       Sun-relative pixel scale as the Moon's offset. Verified via a
       temporary scratch test sweeping ±30s around the real Sunset
       instant: the crossing lands within 0.02px (a small fraction of a
       second) of the official time. `npm run test`: 55/55; `npm run
       check`: 0 errors/warnings.
     - ✅ **Elevation bug fixed** -- `stores/observer.ts` hardcoded
       `elevationM: 0` and `setObserver()` never updated it; both
       pipelines already consumed elevation correctly when given one
       (verified during the investigation above), so this was purely a
       wiring gap. Fixed with an offline DEM lookup rather than a
       single hardcoded default, since manual entry and map-drag can
       land anywhere: `app/src/data/elevation.json` (ETOPO 2022, 60
       arc-sec, NOAA/NCEI, public domain -- blends topography and
       bathymetry, which matters for interpolation robustness at
       coastal/island sites like A Coruña or Palma de Mallorca, not
       because underwater elevation itself is meaningful here; the
       result is still clamped to >=0 in the lookup itself, since every
       real observer stands on land, not because the source data needed
       clamping), resampled to a 1/24° grid (229x409, 442KB) via
       `tools/build-data/generate_elevation.py`. `src/data/elevation.ts`
       does the client-side bilinear interpolation, called from inside
       `setObserver()` -- the single choke point both TopBar's manual
       lat/lon entry and MapPanel's click/drag already went through, so
       both pick it up automatically with no per-caller wiring. Verified:
       Calamocha now reads 906m (vs. the 884m reference -- a resampled-
       grid-scale difference, not an error), A Coruña 28m (small
       positive, correctly coastal), open Mediterranean correctly
       clamped to 0 (was -395m in the raw grid). Contact times shifted
       by about a second and Sunset by ~16s once fed a real, nonzero
       elevation instead of 0 -- both directionally and physically
       plausible (a real elevation gain, delaying sunset via the
       observer's own local horizon plane). Device GPS (not yet wired
       up at all -- PLAN.md's "Use device location" button has no
       handler yet) will eventually be able to override this DEM lookup
       with a direct altitude reading when available; until then this
       offline estimate is used everywhere. `npm run test`: 55/55;
       `npm run check`: 0 errors/warnings.
     - ✅ **Elevation shown in TopBar** -- a small read-only "N m" span
       next to the lat/lon inputs (`$observer.elevationM`, rounded),
       so the DEM lookup above is actually visible rather than only
       affecting calculations silently. Updates live on manual entry
       and map drag alike, since both already flow through the same
       `setObserver()`. Verified in-browser: Calamocha shows "906 m",
       switching to A Coruña updates it to "28 m". `npm run test`:
       55/55; `npm run check`: 0 errors/warnings.
   - ✅ Wire TimeBar to real contact times instead of `STUB_CONTACTS` --
     the `clock` store was redesigned around a real UTC epoch
     (`simTimeMs`, standard `Date` convention) plus a new `effectiveTime`
     derived store (`clock` in `live` mode always tracks the real
     ticking `now`, continuously -- a correctness fix over the mock,
     which never actually animated the cursor in Live; `sim` mode uses
     `simTimeMs` as before). Domain, warp/stretch curve, tick/hour
     labels (now real CEST wall-clock via `Intl`, timezone-aware), and
     the C1..C4/Max lines all derive reactively from the live
     observer's `localCircumstances`. Gracefully degrades outside
     totality: C2/C3/totband are simply omitted rather than breaking
     (verified against Paris). Live/Sim arm-confirm guard, fresh-sim-
     entry positioning (C2-90s, falling back to Max-90s outside
     totality), and playback all verified working. `npm run test`:
     105/105; `npm run check`: 0 errors/warnings.
   - ✅ **Replaced the arcsinh warp curve with two fixed-domain zoom
     levels**, per direct request ("get rid of the arsinh scaling").
     The Real/Stretch/Stretch+ buttons and their `Math.asinh`/`Math.sinh`
     warp-unwarp pair are gone; the track is always plain linear now.
     `ClockState.curveLevel` (`'real'|'stretch'|'stretchplus'`) replaced
     with `zoomLevel: 'in'|'out'` (`stores/clock.ts`), driving the
     *domain* instead of a curve: **Zoom in** shows Max ±10min; **Zoom
     out** shows a fixed **2026-08-12 15:30-20:00 UTC** window (a literal
     constant, not derived from contact times -- explicitly called out
     as a placeholder, "will be removed later"). Tick/label granularity
     now adapts to how wide the current domain is (1min steps under
     40min, else 10min; major ticks at 5min or the hour respectively)
     instead of the old two-overlaid-scales-plus-collision-detection
     scheme, which is gone along with the `$effect` that ran
     `getBoundingClientRect` every render to hide colliding minute
     labels. Contact markers (C1..C4/Max/Sunset) outside the currently
     visible domain are now filtered out rather than rendered at a huge
     off-track percentage (matters a lot zoomed in, where only C2/Max/C3
     are normally in view); the totality band and cursor are clamped/
     hidden the same way. Verified in-browser: Zoom out shows ticks
     17:30-22:00 CEST (=15:30-20:00 UTC) with all five contacts visible;
     Zoom in shows only C2/Max/C3 in a 20min window with correctly
     non-overlapping labels (measured via `getBoundingClientRect`, no
     collision); the cursor correctly hides (opacity 0) when the live
     clock falls outside whichever domain is selected, which it always
     does before the event itself. `npm run test`: 63/63; `npm run
     check`: 0 errors/warnings.
   - ✅ **Added a third, "Default" zoom level back in between**, per
     direct feedback ("the zoom is either in or out. Needs to have the
     old default setting in between") -- `ZoomLevel` is now
     `'in'|'default'|'out'`, `'default'` reusing the exact original
     (pre-zoom-buttons) domain, C1..C4/sunset with the same 30min
     margin as before, and made the actual initial store value (this IS
     the old default, restored). **Zoom in** redefined too, twice over
     direct correction -- first suggested as Max +/-5min, then corrected
     to **C2..C3 with a 3min margin either side** (falling back to Max
     +/-3min where this observer sees no totality, so the track still
     doesn't break). The existing domain-width-adaptive tick step needed
     no changes -- the new zoom-in span (totality duration + 6min, ~7-8
     min here) and the restored default span (~2h) both already fall on
     the correct side of the existing 40min 1min-vs-10min-ticks
     threshold. Verified in-browser: Default loads by default and shows
     all five contacts across the original ~19:05-21:37 CEST range; Zoom
     in now shows only C2/Max/C3 across ~20:27-20:35 CEST (C2-3min to
     C3+3min); label anti-collision still clean at the new, even
     narrower zoom-in width. `npm run test`: 63/63; `npm run check`: 0
     errors/warnings.
5. **Location inputs** (manual → map → geolocation → serial GPS) — ⬜ not
   started (mock has manual entry + map click/drag + a geolocation
   placeholder button; serial GPS not touched at all yet).
6. **Time control** + LIVE lock + GPS clock — 🟡 in progress: Live/Sim
   mode switching, the arm-confirm guard, the warp/stretch curve, and
   slider drag/scrub/playback are all real and driven by the live
   observer's actual contact times (§4 above) -- ⬜ **GPS-disciplined
   clock source** (serial NMEA, §6) not started, blocked on milestone 5's
   serial GPS input.
7. **Contacts + sound warnings** — 🟡 in progress: contacts table +
   countdown are real (§4 above) -- sound warnings not started.
8. **Polish / field-hardening**; full **desktop (Tauri) packaging** — ⬜ not
   started. **Tauri admin-rights spike (§2) should happen independently and
   well before this milestone**, not bundled with it — it's a deal-breaker
   feasibility check, not polish.

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
4. **Elements source** — ✅ **generate from `eclipse-calc`**
   (`BesselianEclipse`, a standalone tidied-and-tested Python package
   extracted from the original research sandbox — sibling repo
   `../eclipse-calc`), not NASA's SEdata set. Confirmed feasible after
   review (`docs/PYTHON_REVIEW_FINDINGS.md`) — a working ephemeris-direct →
   degree-3-polynomial-fit generator already exists, and is now packaged,
   tested (27 passing tests), and had 3 real bugs fixed during extraction.
5. **ΔT** — ✅ **locked to 69.1 s** app-wide, rather than NASA SEdata's
   published 75.4 s (§15) — the Python is the designated oracle, so its own
   ΔT (Skyfield's model, ≈68.8 s for this date) governs, not a different
   source's separately-published constant. Independently re-confirmed via
   live IERS data (not just the builtin Skyfield snapshot): 69.17 s, within
   0.07 s of the locked value.
6. **Missing local-circumstances pieces** (magnitude, obscuration,
   position/parallactic angle, Sun/Moon angular semi-diameters — confirmed
   absent from `eclipse-calc`) — ✅ **not blocking**: ship as
   assumed/placeholder values, visually flagged as provisional, and
   implement for real later rather than extending the Python oracle first.
7. **How the app depends on `eclipse-calc`** — ✅ **local editable pip
   install from `tools/`, not vendored/submoduled** (§11) — build-time-only
   dependency, never shipped to the browser, regenerated manually and the
   output JSON committed when the calc changes (matches this section's
   "run once at build time, never at runtime" framing already).

Still open: none currently.

---

## 15. Appendix — ΔT lock and Besselian elements (cross-check reference)

**ΔT is locked to 69.1 s**, app-wide, for the Besselian TD↔UT conversion and
any longitude correction that comes with it (≈0.004178°/s · δT if this ever
changes). This matches the `eclipse-calc` oracle (Skyfield's own ΔT model,
≈68.8 s for 2026-08-12, independently re-confirmed at 69.17 s against live
IERS data) rather than NASA GSFC's SEdata constant below (75.4 s) — the
Python is the designated source of truth, so its ΔT governs, even though
NASA's number is independently defensible on its own terms.

**The app's actual Besselian elements are generated from `eclipse-calc`**
(`BesselianEclipse` — a standalone package, sibling repo `../eclipse-calc`,
extracted and tested from the original research Python; see
`docs/PYTHON_REVIEW_FINDINGS.md` for the extraction history), which fits a
degree-3 polynomial to its own ephemeris-direct Skyfield/JPL DE440s
computation. The NASA table below is kept **only as an independent
cross-check reference** (alongside a second, separately-computed set from
ytliu.epizy.com using JPL DE441, also in the findings doc) — it is *not*
the locked source, and should not be bundled into `besselian-2026.json`.
Useful precisely because it's independent: the Python-derived elements agree
with it to ~5 significant figures, the central line and umbral N/S limits
to ~200–900 m at every spot-checked instant, and the whole path's published
start/end (its own separate figures, not part of this a0/a1/a2/a3 table) to
the *second* in time and ~0.002° in position.

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
