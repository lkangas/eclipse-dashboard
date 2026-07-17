# Horizon Obstruction Check — Plan

Status: **not started, zero code** (tracked as a known gap in `docs/STATUS.md`).
This is a plan only, written before implementation the same way
`docs/GPS-MONITOR-PLAN.md` was — meant to be confirmed/adjusted, not a
finished spec.

---

## 1. Why this matters

PLAN.md §1's second headline fact: this is a **sunset eclipse**. Totality
crosses Spain with the Sun at only ~12° altitude on the NW Atlantic coast
down to ~2° over the Balearics — and PLAN.md says outright: *"a single hill
can hide the whole event."* At a 2–12° altitude, ordinary terrain that would
be a non-issue for a high-Sun event (a ridge a few km away, a line of trees,
a building) can plausibly sit right on top of the Sun's track. Right now
**nothing in the app checks for this** — the location picker, map, and sky
views all assume a flat, unobstructed horizon.

## 2. Core approach: real terrain horizon vs. the Sun's real track

Two things the app already computes, that this feature just needs to
cross-reference against each other:

- **The Sun's real altitude/azimuth at any time**, for any observer —
  `sunAltAzAt(date, lat, lon, elevationM)` in `stores/skyView.ts:139`. Already
  used for the Wide-view sky rendering and the SkyPanel contact tick marks.
- **Ground elevation at any point**, from the bundled DEM — `elevationAt(lat,
  lon)` in `src/data/elevation.ts`, bilinear-interpolated over
  `elevation.json` (ETOPO 2022, currently resampled to a 1/24° ≈ 4.6 km
  grid over a 35–44.5°N, -10.5–6.5°E bbox, 93,661 cells, 432 KB — see §3 for
  why this resolution is the actual limiting factor for this feature).

### 2.1 Building a terrain-horizon profile for an observer

For a given observer (lat/lon/elevation):

1. **Narrow the azimuth window first.** The Sun only traverses a small slice
   of the compass during the event (typically WSW–NW, depending on site) —
   get the actual min/max azimuth directly from the already-computed contact
   positions (C1 through C4 or sunset) rather than scanning the full 360°.
   Pad by a few degrees each side.
2. For each azimuth in that window (e.g. every 1–2°), **ray-march outward**
   from the observer: sample `elevationAt()` at increasing distance (e.g.
   every 200–500 m) out to some cutoff (see §2.3 for why ~30–50 km is
   plenty).
3. At each sampled point, compute the **apparent elevation angle** from the
   observer to that terrain point — not just `atan(height_diff / distance)`,
   but corrected for Earth's curvature (the terrain point's own horizontal
   plane drops away from the observer's the further out it is) and, ideally,
   standard atmospheric refraction (same ~7/6 effective-Earth-radius
   correction used in standard horizon-dip calculations, and consistent with
   whatever astronomy-engine applies to the Sun's own altitude, so the two
   numbers are comparable apples-to-apples).
4. The **maximum** angle along that azimuth, across all sampled distances, is
   the terrain horizon elevation for that azimuth (a nearer, smaller hill can
   easily beat a farther, taller mountain — this is why every distance along
   the ray needs checking, not just the farthest one).

Output: a profile `{ azimuthDeg, terrainAltitudeDeg }[]` spanning the
relevant window.

### 2.2 Cross-referencing against the event

Walk the Sun's real track from C1 (or the event start, whichever's later)
through C4 or sunset (whichever comes first — reusing whatever "next
observable event" logic already exists, see `docs/STATUS.md`'s note on that
being triplicated). At each sample time, interpolate the terrain profile at
the Sun's current azimuth and compare to the Sun's actual altitude:

- **Sun altitude > terrain altitude** at that azimuth → clear.
- **Sun altitude ≤ terrain altitude** → obstructed from that moment on (until/
  unless it clears again, though for a monotonically-setting Sun this is
  normally a one-way transition).

The output that actually matters to a user: *which contacts, if any, would
already be behind terrain* — e.g. "C3 and C4 are predicted blocked by terrain
to the WNW" — not a raw angle diff.

### 2.3 Ray-march cutoff distance — why ~30–50 km is enough

For a terrain feature at horizontal distance *d* to visually reach an
apparent altitude *θ*, its height above the observer needs to be roughly
`d·tan(θ) + d²/(2R)` (the second term is curvature drop, R ≈ 6371 km). At the
lowest altitudes this event cares about (~2–5°):

| Distance | Height needed for θ=3° | Height needed for θ=5° |
|---|---|---|
| 5 km | ~260 m (a real hill) | ~440 m |
| 20 km | ~1050 m (real mountain) | ~1750 m |
| 50 km | ~2620 m + curvature (rare in Iberia except real ranges) | ~4380 m (essentially nothing in Spain reaches this) |

Past ~50 km, only a genuinely enormous, distant mountain range could still
matter at these Sun altitudes, and Iberia doesn't have one positioned to
matter for this event's geometry — so capping the ray-march there (or even
at 30 km) loses essentially nothing while keeping the computation cheap.

## 3. DEM resolution — the real constraint, and concrete options

**This is the actual limiting factor**, not the geometry above. The current
bundled grid is ~4.6 km/cell. A "hill 3 km away" — exactly the kind of
feature most likely to matter at a 2–5° Sun altitude — can fall entirely
between two grid points, or get smeared away by the bilinear interpolation
that's perfectly fine for a location picker's elevation display but wrong for
this purpose. Options, cheapest first:

| Tier | Source / change | Resulting resolution | Bundle size (whole current bbox) | Effort | What it actually buys |
|---|---|---|---|---|---|
| **0 — current** | ETOPO 2022, resampled to 1/24° (existing `elevation.json`) | ~4.6 km | 432 KB (already shipped) | none | Catches only genuinely large, distant mountain ranges. Misses almost everything actually relevant at this event's Sun altitudes. |
| **0.5 — near-free** | Same ETOPO 2022 source already fetched by `generate_elevation.py`, just resample less aggressively — its **native** resolution is ~60 arc-sec (~1.4 km) | ~1.4 km | ~6× the cells ≈ ~2.6 MB raw (likely well under 1 MB gzipped — highly repetitive small integers) | Trivial — change one constant (`STEP`) in the existing script, same download, same license, no new attribution | A real ~3× linear density gain for free. Still can't see a single close hill, but starts to resolve real local ridgelines. |
| **1 — meaningful upgrade** | Swap source to **Copernicus DEM GLO-30** (ESA/Copernicus, TanDEM-X-derived, ~30 m, free with attribution — verify exact license text before shipping) or **EU-DEM v1.1** (Copernicus Land Monitoring Service, 25 m, Europe-specific, SRTM+ASTER-derived), bundled over a **narrower corridor** (e.g. ±40–50 km around `shadow-frames.json`'s central line, not the whole existing Iberia+Balearics bbox) | 25–30 m | Depends heavily on corridor width and encoding (see below) — whole-bbox at this resolution is ~200M+ cells (infeasible); a tight path corridor at a coarser resample (e.g. 200–500 m) is a few MB; a denser encoding (packed `Int16Array`/binary blob or a PNG-encoded heightmap instead of a JSON number array) could push this further for the same byte budget | Moderate — new source, new fetch/reprojection step in `tools/build-data`, needs its own license verification and `NOTICE.md` entry | Genuinely resolves nearby ridges/hills along the actual path where people will stand. Still one bundled asset, still supports arbitrary click-anywhere *within the corridor*. |
| **2 — best fidelity, narrowest coverage** | **Precompute horizon profiles only** (§2.1's tiny output, not raw terrain) for a fixed set of candidate sites — the 11 existing presets, plus optionally a denser sampling grid along the corridor — from a high-res source used **only inside the generation script, never bundled**: Spain's own **IGN MDT05/MDT02** (5 m / locally 2 m, LIDAR-derived, via the CNIG download center — confirm current license terms before use) or Copernicus GLO-30 | 5–30 m at the source, but the *bundled* output is just per-site azimuth→angle arrays | Tiny — each profile is ~60–90 floats, a few hundred bytes per site; even hundreds of sites would be well under 100 KB total | Higher — per-sheet tile mosaicking/reprojection (ETRS89/UTM→WGS84 lat-lon) for the Spanish source, comparable in kind to the reprojection/winding-order work `basemap-global.mjs` already does | Best possible accuracy at the specific sites people actually observe from. Doesn't cover a literally-arbitrary map click with full precision — falls back to whichever whole-area tier (0.5 or 1) is in place elsewhere, or shows "nearest precomputed profile is N km away." |

**Recommendation:** do **Tier 0.5 immediately** (it's free) regardless of
what else happens, as the new baseline. Then **Tier 1** for real
coverage along the actual path corridor. **Tier 2 is a good stretch
addition later** for the preset sites specifically (where people are most
likely to actually stand), not a blocker for shipping something useful —
it can layer on top of whichever whole-area tier is already in place.

### 3.1 What no DEM tier will ever solve

Worth stating plainly, and putting **in the UI itself**, not just this doc:
**no bare-earth DEM (any of the above) sees trees, buildings, or the exact
hillock you're standing behind.** That needs a Digital Surface
Model/canopy-height data (LIDAR first-return, not ground-return) — a
fundamentally different, heavier dataset, and even then only accurate at
whatever moment the LIDAR flight happened (vegetation grows, buildings get
built). This feature, at every tier above, can only ever be a **"no major
distant terrain in the way" pre-trip sanity check** — never a guarantee. The
final answer always requires looking at the actual horizon on site.

## 4. Data pipeline changes

- `tools/build-data/generate_elevation.py`: for Tier 0.5, change `STEP` (and
  re-fetch the same two ERDDAP chunks at native resolution if the current
  request already truncates to 1/24° server-side — needs checking against
  the actual ERDDAP query). For Tier 1, this becomes closer to a new sibling
  script (`generate_horizon_dem.mjs`/`.py`) given the different source/format
  and the corridor-clipping logic (reuse `shadow-frames.json`'s central line
  the same way `basemap-global.mjs` reuses precomputed geometry elsewhere).
- `NOTICE.md`: new entry for whichever Tier-1 source is chosen, following the
  existing per-file convention exactly (provenance, license, attribution
  requirement if any, regeneration command).
- Tier 2 (if pursued): a new `src/data/horizon-profiles.json`, generated by a
  script that downloads/uses the high-res source **only in `.cache/`
  (gitignored)**, same pattern as `generate_elevation.py`'s own
  `.cache/etopo2022/`.

## 5. Runtime module & store

- **`src/eclipse/horizon.ts`** (new, pure, alongside `elements.ts`/
  `localCircumstances.ts`) — `terrainHorizonProfile(lat, lon, elevationM,
  azMinDeg, azMaxDeg): {azimuthDeg, terrainAltitudeDeg}[]` (§2.1) and
  `checkHorizonObstruction(profile, sunTrack): ObstructionResult` (§2.2). Pure
  functions, fully unit-testable without any DOM/serial dependency — matches
  this codebase's existing convention of keeping geometry/computation pure
  and separately tested from UI.
- **`stores/horizonObstruction.ts`** (new derived store) — recomputes
  whenever `observer` changes, same reactive shape as
  `stores/localCircumstances.ts`. Cheap enough (a few dozen azimuth rays,
  each a few dozen distance samples against an in-memory grid) to run on
  every observer change without debouncing.

## 6. UI integration

- **SkyPanel Wide view**: replace the current flat horizon line with the real
  terrain silhouette for the current observer, drawn the same way the
  existing sky elements are (an SVG polyline across the visible azimuth
  range). This directly fulfills what PLAN.md §7 always described for this
  view ("the horizon line, and the Sun's track toward setting") with real
  data instead of a flat assumption.
- **A warning near the Contacts panel/location bar** when
  `checkHorizonObstruction` predicts any contact blocked — reusing the
  existing "provisional" (†) visual language already used for
  magnitude/obscuration placeholders, but worth a stronger treatment than
  that footnote-style flag given this is actually safety/trip-planning
  relevant, not just a data-quality caveat (see open question in §8).
- The §3.1 caveat ("distant-terrain check only, not a guarantee — verify on
  site") needs to sit directly next to whichever of the above is shown, not
  live only in this doc.

## 7. Testing strategy

- Curvature/refraction formula: unit test against a known closed-form
  reference (e.g. the standard horizon-dip-angle formula for an observer at
  height *h*, `dip ≈ 1.76′·√h_meters` with standard refraction) at a few
  reference heights.
- `terrainHorizonProfile`: a synthetic flat-plane fixture (every cell the
  same elevation) should produce ~0° (or a small negative dip, matching the
  observer's own height above that plane) at every azimuth — the "no
  obstruction anywhere" baseline case.
- A synthetic "wall" fixture (one ring of cells at a known height/distance)
  should produce a predictable, hand-computed angle at the corresponding
  azimuth — validates the ray-march + max-angle-wins logic end to end.
- `checkHorizonObstruction`: unit tests for clearly-clear, clearly-blocked,
  and "blocked partway through the event" cases using synthetic profiles and
  synthetic Sun tracks (no real ephemeris needed to test this half).
- Once real data is wired in: a known real-world sanity check if one can be
  found (e.g. a location with a documented close mountain to the west) would
  be the strongest validation, but isn't a blocker for shipping the
  synthetic-fixture coverage above.

## 8. Open questions to confirm before implementing

1. **Which DEM tier to start with?** Recommendation is 0.5 now, 1 as the real
   target, 2 deferred — confirm that's the right pace, or whether Tier 1
   should be scoped in from the start.
2. **Corridor width for Tier 1**, if pursued — how far off the central line
   should the bundled dense DEM extend? Needs to cover realistic candidate
   sites (the existing 11 presets already span a fair spread), not just the
   mathematical centerline.
3. **Refraction correction** — include it (matches how the Sun's own altitude
   is presumably computed) or skip it for simplicity? Effect is small
   (~34′ at the true horizon, less above it) but non-zero at these low
   altitudes.
4. **How insistent should the UI warning be?** A quiet badge (like the
   existing † provisional-value flags) risks being missed for something
   this consequential; something louder (a banner, a confirmation dialog
   when picking an obstructed site) risks being annoying for sites that are
   only marginally/uncertain-ly affected given DEM resolution limits. This
   is a product-feel call, not a technical one.
5. **License verification** — Copernicus DEM, EU-DEM, and IGN's MDT
   products are all described above as free/open based on general knowledge
   of these programs, but exact current license text should be checked
   before committing to a source and writing the `NOTICE.md` entry, the
   same care already given to `stars.json`'s CC BY-SA share-alike callout.

## 9. Phasing recommendation

| Phase | Scope |
|---|---|
| **1** | Tier 0.5 DEM swap (free) + `horizon.ts`/`horizonObstruction.ts` core logic + unit tests (§7) against the existing (denser) grid — no UI yet, provable correctness first. |
| **2** | SkyPanel Wide-view terrain silhouette overlay + the Contacts/location warning, wired to Phase 1's store. |
| **3** | Tier 1 DEM (corridor-clipped, higher-res source) replacing Tier 0.5 under the same interface — UI/logic from Phase 2 shouldn't need to change, only the data underneath it gets better. |
| **4 (optional/stretch)** | Tier 2 precomputed per-site profiles for the preset sites, layered on top for extra fidelity where it matters most. |
