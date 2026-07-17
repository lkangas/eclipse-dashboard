# Horizon Obstruction Check — Plan

Status: **Phases 1-2 (§9) implemented, tested, and live-verified.** Landed:
Tier 0.5 DEM swap (`elevation.json` regenerated at ETOPO's native ~1.4-1.9km
resolution instead of the old 1/24deg ~4.6km downsample, 582,991 cells,
2.7MB); `src/eclipse/horizon.ts` (`terrainHorizonProfile` ray-marches the
DEM with Earth curvature + standard terrestrial refraction via the 7/6
effective-radius approximation -- deliberately a DIFFERENT correction from
the Sun's own astronomical refraction, see the module's own comment;
`checkHorizonObstruction` checks each named contact's already-known Sun
position directly against the profile, rather than sampling a continuous
track and searching for a crossing as originally sketched in Sec2.2 below --
simpler and all the UI actually needs); `stores/horizonObstruction.ts` (one
shared derived store feeding both consumers so they can't disagree);
SkyPanel's Wide-view horizon line/ground fill now follow the real computed
terrain silhouette instead of a flat assumption; ContactsPanel flags any
predicted-obstructed contact both per-row and with a summary warning
(`#c22`, the same color TopBar's own elevation-out-of-bounds flag already
uses). 16 new unit tests (curvature/refraction vs. the independent 1.76'*sqrt(h)
reference, synthetic flat-plane and ring-wall fixtures, azimuth-window
handling, obstruction-check clear/blocked cases) plus live-verified against
a real steep-terrain location (Torla/Ordesa, Pyrenees) showing genuinely
different, larger terrain-silhouette variation and a real obstruction
result, confirmed against the unaffected Calamocha default afterward.
242/242 tests passing, typecheck clean.

**One characteristic worth knowing, not a bug**: the "Sunset" contact
trips the obstruction flag almost everywhere, including the Calamocha
default -- it's checked against a threshold within a fraction of a degree
of the idealized flat-horizon 0°, and real terrain (even gentle, distant
hills) almost always sits at least that high in the real world. C1-C4
require genuinely significant nearby terrain to trigger, and are the more
discriminating/useful signal; Sunset itself is rarely the actual eclipse
event anyway (usually well after C3/C4 -- see each site's own margin in
PLAN.md Sec1).

Phase 3 (denser Tier-1 DEM) and Phase 4 (real-hardware/field validation,
not applicable here the way it was for the GPS monitor) not started.

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
this purpose.

**Coverage must be the whole reachable area, not a fixed list of sites or a
narrow path corridor.** Clear-weather chasing on the day means driving to
wherever the sky actually cooperates, which can't be predicted in advance —
so anything that only works at pre-selected points (named presets, or a
precomputed profile for a short list of candidate spots) is the wrong shape
for this feature, no matter how accurate those points are. That rules out an
earlier draft of this plan that considered precomputing horizon profiles for
just the 11 preset sites — dropped entirely, not revised, since no fixed list
solves "wherever I end up."

**The real lever is encoding, not area.** `elevation.json` today stores each
cell as decimal text in a JSON array (~4.6 bytes/cell average) — fine at
93,661 cells, wasteful at millions. Switching to a compact binary encoding
(a flat `Int16Array` of meters — elevation values everywhere in and around
Spain fit comfortably in a 16-bit signed range — served as a raw `.bin`
fetched/imported as an `ArrayBuffer`) cuts per-cell cost roughly in half
and removes JSON's text-formatting overhead entirely, which changes what's
feasible over the *entire* existing bbox (same 35–44.5°N / -10.5–6.5°E area
the app already covers end to end):

| Resolution | Cells (whole existing bbox) | Raw size (Int16 binary) | Gzipped (est.) |
|---|---|---|---|
| Current (~4.6 km, JSON text) | 93,661 | — | 432 KB (shipped today) |
| ~1.4 km (ETOPO native, Tier 0.5) | ~583,000 | ~1.2 MB | ~0.4–0.6 MB |
| **~1 km** | ~1.6M | ~3.2 MB | **~1–1.5 MB** |
| ~500 m | ~6.5M | ~13 MB | ~4–6 MB |
| ~250 m | ~25.8M | ~52 MB | ~15–25 MB (likely overkill — see §2.3, close obstructions matter most within a few km, and terrain this side of ~1 km rarely changes meaningfully over 250 m of lateral distance) |

~1 km or ~500 m over the **entire current bbox** — i.e. anywhere across Spain
and its surroundings you could plausibly chase weather to — is a perfectly
reasonable one-time download for an offline field app, once stored as
binary instead of JSON text. No snapping to nearest precomputed point, no
"only works near a preset" limitation: the observer store already carries an
arbitrary lat/lon from any source (manual, map click, GPS, serial), and
`terrainHorizonProfile` (§2.1) just reads whatever's under it.

Where a higher-res source (Copernicus DEM GLO-30, EU-DEM 25 m, or Spain's own
IGN MDT05/MDT02 LIDAR data, ~5 m) fits in: as the **input** to generating
this whole-area grid, resampled down to the target resolution — the same
"fetch dense, resample down, bundle only the resampled result" pattern
`generate_elevation.py` already uses with ETOPO, not a reason to restrict
*coverage*. A plausible refinement later: use IGN's data (more
authoritative within Spain) for the Spain portion of the resample and fall
back to Copernicus/ETOPO for the slivers outside it (French border,
Portugal edge, open sea) — still one whole-area grid, still no fixed-site
restriction, just a better-sourced input in the region that matters most.

**Recommendation:** do the **free ETOPO-native (~1.4 km) swap immediately**
(§3, "Tier 0.5" below) as the new baseline regardless of what else happens.
Then move straight to a **binary-encoded whole-bbox grid at ~1 km (or 500 m
if the larger download is acceptable)**, sourced from a denser DEM than
ETOPO if one's worth the integration effort — this replaces both the old
"narrow corridor" and "fixed preset sites" ideas with a single design that
actually covers wherever you might end up driving.

### 3.0 Real-world precedent: PeakFinder

Worth checking against, since PeakFinder (the mountain-panorama app/API)
solves this exact class of problem — what terrain is visible/blocking from
an arbitrary point — at global scale, and confirms the direction above
rather than the earlier fixed-site draft:

- **Global base + regional override, the same pattern already recommended
  here.** Per PeakFinder's own resources page: a global base of NASADEM +
  SRTM (3-arcsec/~90m and 1-arcsec/~30m, via the "Viewfinder Panoramas"
  project — Jonathan de Ferranti's long-running DEM cleanup/void-filling
  effort, purpose-built for horizon rendering, not a general-purpose DEM
  repurposed for it), layered with a **higher-quality LiDAR compilation for
  Europe specifically** ("collected and resampled by Sonny," the same
  project). Directly analogous to this plan's "global source + Spain's IGN
  data as a regional override" idea (§3) — real precedent, not just a guess.
- **Rendered live from arbitrary lat/lon, not precomputed per fixed site.**
  PeakFinder's own description ("same technology as in computer games") and
  its public API (arbitrary lat/lon + azimuth + FOV + a visibility-range
  parameter) confirm it ray-casts on demand against real terrain data for
  whatever point it's given — not a fixed list of precomputed panoramas.
  Working confirmation that abandoning the fixed-site draft (§3 above) was
  the right call, not a fallback compromise.
- **Their problem is actually wider than ours in one dimension**: visibility
  range up to 320km, because a scenic panorama needs to show genuinely
  distant tall mountains. This event's horizon check only cares about
  terrain close enough to block a 2–12° Sun — §2.3's own math already caps
  that at ~30–50km, so this app's version of the problem is narrower, not
  harder.
- Viewfinder Panoramas' own Europe LiDAR compilation (free, purpose-built
  for this) is worth investigating as a candidate source alongside Copernicus
  DEM/EU-DEM/IGN in §3's Tier 1 — same license-verification caveat as the
  others applies before committing to it.
- No public detail found on PeakFinder's actual tiling scheme, offline
  package sizes, or file format — kept proprietary, unsurprisingly, so
  nothing to borrow there directly.

| Tier | Source / change | Resulting resolution | Bundle size (whole bbox) | Effort |
|---|---|---|---|---|
| **0 — current** | ETOPO 2022, resampled to 1/24° (existing `elevation.json`) | ~4.6 km | 432 KB (shipped) | none |
| **0.5 — near-free** | Same ETOPO 2022 source already fetched by `generate_elevation.py`, resampled less aggressively to its native ~60 arc-sec | ~1.4 km | ~1.2 MB raw / ~0.5 MB gzipped | Trivial — change one constant (`STEP`), same download, same license |
| **1 — the real target** | Binary (`Int16`) encoding of a denser source (ETOPO itself goes no denser than native; Copernicus GLO-30/EU-DEM would need reprojection/resampling work) over the **whole existing bbox** | ~1 km (or 500 m) | ~1–1.5 MB (1 km) or ~4–6 MB (500 m) gzipped | Moderate — new binary-serialization step in the build script, `elevation.ts`'s reader updated to parse an `ArrayBuffer` instead of a JSON array (interface to callers — `elevationAt`/`isWithinElevationBounds` — unchanged) |

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
  the actual ERDDAP query).
- For Tier 1 (binary whole-bbox grid): either extend this same script to
  write a second, denser binary output, or a new sibling script if the
  source changes (e.g. Copernicus GLO-30 needs a different fetch/reprojection
  path than ERDDAP). Either way the **output format changes** — a flat
  `Int16` binary blob (e.g. `elevation-fine.bin`) instead of a JSON number
  array, imported/fetched as an `ArrayBuffer` at runtime. `elevation.ts`'s
  public interface (`elevationAt`, `isWithinElevationBounds`) stays the same;
  only its internal `cellValue`/lookup needs to read from a typed array
  instead of `elevationData.elevationsM`. Whole existing bbox, no corridor
  clipping, no per-site restriction (§3).
- `NOTICE.md`: new entry for whichever Tier-1 source is chosen, following the
  existing per-file convention exactly (provenance, license, attribution
  requirement if any, regeneration command).

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

1. **Which DEM tier to start with?** Recommendation is 0.5 immediately, Tier 1
   (binary whole-bbox grid) as the real target — confirm that pace, or
   whether it's worth skipping straight to Tier 1.
2. **Target resolution for Tier 1** — ~1 km (smaller download, ~1–1.5 MB
   gzipped) vs. ~500 m (noticeably better, ~4–6 MB gzipped). Both cover the
   whole existing bbox with no site restriction; this is purely a
   download-size-vs-fidelity call.
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
| **3** | Tier 1: binary-encoded, whole-bbox ~1 km (or 500 m) grid replacing Tier 0.5 under the same `elevation.ts` interface — UI/logic from Phase 2 shouldn't need to change, only the data underneath it gets better, and coverage stays everywhere the app already covers (no site restriction at any phase). |
