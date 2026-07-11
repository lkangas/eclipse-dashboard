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
     (exact center, framing) to be refined later. Will eventually want the
     **momentary penumbral shadow** (the whole region seeing any partial
     eclipse right now, not just totality) as its moving-shadow overlay --
     the natural big-picture counterpart to the Spain tab's umbral shadow.
     Not started (§4 already flags penumbral N/S *limits* as unneeded and
     unvalidated for this event; the penumbral shadow *outline* is a
     separate, later piece specifically for this tab).

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
- **Future: global circumstances toggle** — an optional expanded view of the
  contacts table/panel showing the eclipse's *global* circumstances (not just
  this observer's local C1–C4), modeled on the "Eclipse Times" section of
  ytliu.epizy.com's calculator (already used as a cross-check reference,
  §15) — e.g.
  https://ytliu.epizy.com/eclipse/one_solar_eclipse_general.html?ybeg=2001&ind=55&DE=441.
  The locally-computed circumstances (§4) would be interleaved within that
  longer table rather than shown separately. Eventually extend the sound-
  warnings toggle below to cover entries in this table too, not just local
  contacts. Being long, it needs the fullscreen lightbox pattern noted in
  §10 rather than an in-panel scrollbar — only this expanded view
  scrolls/goes fullscreen, the default local-only view (above) does not.
  Not started.
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
