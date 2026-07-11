# Python eclipse-code review brief

Scope note for whoever (whichever session) picks this up: this doc is only
about the **calculation layer** — what the existing Python needs to be able
to produce, and what else is worth checking while reading it. Full app
architecture/UI context is in `docs/PLAN.md` (§4 "Eclipse computation core"
is the section this maps onto most directly). Read that first for context,
then use this as the checklist while going through the Python.

Goal of the review: figure out (a) what the Python already computes, (b)
what's missing relative to what the app needs (listed below), (c) how
directly portable it is, and (d) anything that changes the porting plan.
Doesn't need to produce a port yet — just an inventory + gap list.

---

## 0. Locked facts to cross-check the Python against

These numbers are already verified from two independent sources (NASA
GSFC's SEdata, and an independently-computed set from ytliu.epizy.com using
JPL DE441) and can be used as an immediate sanity check on whatever the
Python outputs, before writing any formal test harness.

**NASA GSFC (VSOP87/ELP2000-82, ΔT = 75.4s), Besselian elements at
T0 = 2026-08-12 18.000 TD, t = (T − T0) in hours:**

```
        a0            a1           a2           a3
x    0.4755140    0.5189249   -0.0000773   -0.0000080
y    0.7711830   -0.2301680   -0.0001246    0.0000038
d   14.7966700   -0.0120650   -0.0000030    0
μ   88.7477870   15.0030900    0            0        (deg)
l1   0.5379550    0.0000939   -0.0000121    0
l2  -0.0081420    0.0000935   -0.0000121    0        (negative => total)
tan f1 = 0.0046141   tan f2 = 0.0045911
```

**ytliu.epizy.com (JPL DE441, ΔT = 69.2s), same event, T0 = 18:00:00 TD,
t = decimal hours − 18:**

```
        a0            a1           a2           a3
x    0.47551538   0.51892524  -0.00007734  -0.00000803
y    0.77118709  -0.23016807  -0.00012462   0.00000377
μ0  88.74779105  15.00309003   0.00000175  -0.00000002
d   14.79668327  -0.01206481  -0.00000310  -0.00000001
l1   0.53797878   0.00009183  -0.00001209   0.00000000
l2  -0.00813765   0.00009138  -0.00001203   0.00000000
tan f1 = 0.0046141   tan f2 = 0.0045912
```

Both agree to ~5 significant figures on the elements themselves; the ~6s
ΔT disagreement (75.4 vs 69.2) is the main source of any position mismatch
(~6s x 0.004178°/s longitude shift, per EclipseWise's own conversion
note — small but not negligible at the precision this app wants).

**Global event facts** (from ytliu, cross-checked against PLAN.md's
NASA-derived table — should match to the second/hundredth of a degree):

- Greatest eclipse: 2026-08-12, 17:47:06 TD / 17:45:56 UT1, at 65°13.4'N
  25°14.4'W (off Iceland). Magnitude 1.0386, Gamma 0.8977, path width 294km,
  central duration 2m18s at that point.
- C1 of the whole path (umbra first touches Earth): 17:00:07 UT, 75°04.7'N
  113°26.6'E (Siberia).
- C2 of the whole path (umbra last touches Earth, sunset-limited): 18:32:12
  UT, 38°40.8'N 5°24.1'E (Mediterranean, east of the Balearics).
- Central line crosses the Spanish coast (Galicia/Asturias) around
  18:26–18:28 UT and exits near the Balearics around 18:32 UT.

**Central-line / N-limit / S-limit fixes over Spain** (1-min steps, UT,
from ytliu — already transcribed into `design/layout-v3-fullscreen.html`'s
map data, decimal degrees, if a quick diff is useful):

```
18:18  N 49.3533,-11.5883  S 49.2050,-16.8017  C 49.3100,-14.2783
18:22  N 47.0650,-8.8517   S 47.1067,-14.4383  C 47.1267,-11.7600
18:26  N 44.4883,-5.0217   S 44.8583,-11.4717  C 44.7417,-8.4567
18:30  N 40.7483,3.0400    S 42.2950,-7.3083   C 41.8567,-3.2833
Limit  N 39.7067,6.3283    S 37.6900,4.5283    C 38.6800,5.4017
```

If the Python can emit a central-line/N-limit/S-limit table, this is the
fastest way to confirm it's producing sane numbers — check a couple of
these rows against its output before trusting anything else.

**Representative Spanish sites** (from PLAN.md §1, cross-checked to <0.5°
alt and ~2s duration against two sources) — good spot-check targets for
`localCircumstances`:

| Site | Lat/Lon | Alt at mid-totality | Totality duration |
|---|---|---|---|
| A Coruña | 43.36,-8.41 | ~12° | ~1m16s |
| Oviedo/Gijón | 43.36,-5.85 | ~10° | ~1m45s |
| Zaragoza | 41.65,-0.89 | ~5.9° | ~1m25s |
| Bilbao | 43.26,-2.94 | ~8.2° | **~0m32s** (northern edge) |
| Valencia | 39.47,-0.38 | ~4° | **~0m58s** (southern edge) |
| Palma de Mallorca | 39.57,2.65 | ~2.4° | ~1m36s (essentially setting) |

**Calamocha (the app's actual default observation site, 40.92°N,
1.30°W)** has no independently-verified reference numbers yet — this is
one of the first things worth computing once the Python's local-circumstances
function is confirmed working, since it's what the app will actually show.

---

## 1. Local circumstances — for an arbitrary observer (lat, lon, elevation)

This is the core "does this code exist and work" question. For any
observer, at minimum:

- **C1, C2, Max, C3, C4** as UT/TD instants (and whether C2/C3 exist at all
  there — i.e. is the site inside the umbral path, or only partial/no
  eclipse). Newton iteration on the Besselian l1/l2 curves, standard
  Explanatory Supplement / Meeus method.
- **Totality duration** (C3 − C2), when applicable.
- **Magnitude and obscuration** at maximum.
- **Sun altitude/azimuth** at each contact, and ideally as a continuous
  function of time (not just at the 5 instants) — the mock's countdown
  panel and sky views need to track this continuously as the time slider
  is scrubbed, not just snap to contact moments.
- **Moon altitude/azimuth**, topocentric (parallax-corrected for the
  observer), same continuity requirement.
- **Position angle and parallactic angle** of C2/C3 (where on the Sun's
  limb totality begins/ends — useful for the countdown schematic and/or
  sky view, currently drawn as plain concentric circles with no
  orientation in the mock).
- **Sun and Moon apparent angular semi-diameters** at the observer's
  distance (needed so the schematic/sky views draw the disks at the
  correct relative size — Moon must render measurably larger than the
  Sun for the totality to read correctly).

## 2. Path/shadow geometry — independent of any one observer

- **Central line + N/S umbral limits** as a function of time (already have
  a rough table for the Spain-crossing segment, §0 above — need this at
  finer resolution / analytically, not just transcribed from someone
  else's published table).
- **Umbral shadow outline** (the actual ground footprint polygon) at a
  given instant — not just the 3 lines. This is the harder piece: the
  umbra cone ∩ WGS84 ellipsoid intersection curve, which is a long thin
  ellipse-ish shape at this event's low altitude (elongation roughly
  1/sin(altitude) — huge and fast-changing near sunset). PLAN.md §8 wants
  this as the "moving umbral shadow ellipse" on the map, and §3.4 as
  "umbral shadow outlines on a dense UT grid (10–30s) as JSON." Check
  whether the Python already computes the full outline or only the 3
  central/limit lines — this is the single biggest open question for the
  map's next iteration (currently the mock only draws the 3-line/band
  version, no ellipse).
- Penumbral limits — lower priority; not used by the current mock, but
  PLAN.md §8 lists it as a map overlay for later.

## 3. Continuous sky positions — for the Wide/All-sky views

- Sun and Moon RA/Dec (or alt/az), continuously, not just at contacts —
  the mock's sky views (still placeholder) need to draw the Moon
  approaching/overlapping the Sun at whatever instant the time slider is
  scrubbed to.
- This does **not** need to come from the Python if `astronomy-engine`
  (already decided, PLAN.md §2) covers it adequately — but check whether
  the Python's ephemeris source (see §6 below) would give meaningfully
  different Sun/Moon positions than astronomy-engine's, since the eclipse
  geometry (Moon-Sun separation) is sensitive to which one is used. If
  they diverge, decide which is authoritative.
- Star catalog / other sky content is explicitly **not** the Python's job
  (PLAN.md §3.2 — separate HYG-catalog pipeline).

## 4. Time & precision plumbing

- Exact **ΔT** value/source the Python uses or assumes (see the 75.4s vs
  69.2s discrepancy in §0 — the app needs to lock to ONE value
  consistently, PLAN.md §4 already flags this).
- TD ↔ UT conversion used.
- Newton iteration convergence tolerance for contact-time solving (matters
  for how "sub-second accurate" the final port can honestly claim to be,
  PLAN.md §12's validation target).

---

## 5. Panel → data needed (grounding the above in the actual mock)

| Panel (in `design/layout-v3-fullscreen.html`) | Needs from §1–4 |
|---|---|
| Contacts table (Event/T±/Time/Alt for C1,C2,Max,C3,C4,Sunset) + circumstances strip (Duration/Magnitude/Obscuration/Sun az) | §1 in full, plus a sunset time (separate horizon calc, not eclipse-specific) |
| Countdown ("C2−00:41.6" style, single or dual-line) + flat Sun/Moon schematic | §1 contact times (continuously, for the live countdown) + angular semi-diameters; optionally position angle |
| Map: centerline/N-S band, shadow-position marker | §2 in full |
| Map: observer marker + click-to-locate | no calc — just lat/lon passthrough (already wired in the mock) |
| Wide/All-sky views (still placeholder) | §3 in full, plus §1's altitude/azimuth for framing |
| Topbar UT/CEST clocks | §4's TD/UT/ΔT plumbing (not eclipse-specific, just consistent time handling) |

---

## 6. Other things worth examining while reading the code

- **Dependencies / ephemeris source** — does it use Skyfield, Astropy,
  PyEphem, a hand-rolled VSOP87 implementation, JPL kernel files? This
  affects both portability to TS and whether its numbers will match
  `astronomy-engine`'s closely enough (see §3). Note any license terms on
  bundled data files (PLAN.md §3.5 wants a NOTICE covering everything).
- **Existing validation** — does the Python have any tests or known-good
  reference outputs already? If not, generating some (via `tools/gen-vectors`,
  PLAN.md §4) against the numbers in §0 above is a reasonable first step.
- **Output shape** — functions returning structured data vs. a
  print/CLI-only script? Determines how directly it maps onto the planned
  `elements.ts` / `observer.ts` / `localCircumstances.ts` / `path.ts` split.
- **Performance** — how fast is a single local-circumstances evaluation?
  The app may need to re-evaluate continuously while the time slider is
  dragged or during LIVE playback, so anything doing slow numerical
  integration per call may need reworking for a real-time port.
- **Elevation handling** — does it use observer height in the
  geocentric-parallax correction (`ρ·sinφ′, ρ·cosφ′`, WGS84 flattening
  0.99664719 per PLAN.md §4)? Matters for accuracy at specific sites.
- **Atmospheric refraction** — does it correct the Sun's apparent
  altitude for refraction near the horizon? This event has the Sun at
  2°–12° for the whole Spanish corridor, where refraction shifts apparent
  altitude by up to ~0.5° — a big deal for horizon-obstruction warnings
  and for whether "the Sun is still up" claims are accurate. (Separate
  from, but related to, the sky view's atmospheric extinction/dimming,
  PLAN.md §7, which is a rendering concern rather than a geometry one.)
- **Umbra outline math specifically** (see §2) — if this doesn't exist
  yet in the Python, it's the biggest net-new piece of work, not a port.

---

## 7. Suggested first deliverable from the review session

A short report: what functions/modules exist, what each computes, mapped
against §1–4 above (have / partial / missing), plus a spot-check of at
least one known value from §0 (e.g. the 18:26 UT central-line fix, or
Zaragoza's ~5.9° altitude / ~1m25s duration) run through the Python to
confirm it's producing plausible numbers before any porting work starts.
