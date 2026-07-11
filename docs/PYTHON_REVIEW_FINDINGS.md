# Python reference code — detailed findings

Scope: a close read of every file in `C:\Users\lauri.kangas\OneDrive\python\eclipse`
(git repo, first commit `e82a1d7`, 2026-07-11), evaluated against
`docs/PYTHON_REVIEW_BRIEF.md`. This supersedes the informal summary from the
first review pass with a file-by-file, timestamp-ordered account, focused on
**how the Besselian-element calculation itself evolved** across the many
`own_bessels*.py` iterations, since that's copied/rewritten across several
numbered files rather than living in one place.

Chronology is reconstructed from NTFS `LastWriteTime` (last content edit),
gathered via `Get-ChildItem`. **`CreationTime` is not usable for this** — most
files show `CreationTime` clustered into a handful of identical batch
timestamps (e.g. four unrelated files all "created" `2024-03-18 10:42:23-24`),
which is a OneDrive re-sync artifact, not original authorship. `LastWriteTime`
is preserved through OneDrive sync and lines up with a coherent, plausible
evening-by-evening progression, so that's what the timeline below uses
throughout.

---

## 1. Direct answer: the polynomial ↔ ephemeris switch

You asked specifically about this, so up front:

**The order was: copied polynomial → self-computed ephemeris → self-computed
polynomial (fit from ephemeris).** Three distinct stages, not a single switch:

1. **2024-01-02 (`skyfield_test1.py`, `bessel_test1.py`)** — elements come from
   a **manually transcribed table of someone else's published polynomial
   coefficients** (a NASA-style `a0..a3` table for the 2024-04-08 event,
   T0=18h). `np.polyval` evaluates it. Skyfield is used only to find the
   sub-shadow point for the map projection — **not** to compute any Besselian
   element. Nothing is self-computed yet.
2. **2024-03-11 → 2024-03-24 (`own_bessels.py` through `own_bessels6.py`,
   consolidating into `calculations.py`)** — elements are computed **directly
   from JPL ephemeris via Skyfield at whatever instant is needed** (dense
   per-second grids, single instants, or points visited during a root
   search). No polynomial anywhere in this stretch — `own_bessels.py`
   (2024-03-11) briefly re-fits its ephemeris output to a polynomial just to
   *validate* the fit visually, but that fit is never evaluated again or used
   downstream; `own_bessels2.py` five days later drops the idea entirely.
   `calculations.py` crystallizes out of this phase as the reusable library,
   and stays pure ephemeris-direct throughout: `find_minima`/`find_discrete`
   re-evaluate the ephemeris at every trial time during a search, rather than
   solving a closed-form polynomial.
3. **2024-04-07 (`polynom_bessels.py`, the `Bessels` class)** — **switches
   back to polynomial coefficients**, but self-generated this time: sample
   the ephemeris-direct formula (`raw_bessels_at`, a near-verbatim copy of
   `calculations.py`'s `bessels_at`) at only 5 coarse points across ±3 hours,
   `np.polyfit` each element to degree 3, then do all further work (contact
   search, shadow outline, N/S limits) against the cheap cached polynomial via
   `np.polyval`/`np.polyder`. This is the final, most complete, and only
   "production-used" form (`gps_test.py`, the very next day, builds on it
   directly).

So the destination matches where NASA's own SEdata table lives structurally
(a locked degree-3 polynomial per element) — but you arrived there by
computing it yourself from ephemeris first, fitting only for performance
(avoiding repeated slow ephemeris calls during iterative solves), not because
a closed-form fit was ever in doubt. That's good news for the app: the
`Bessels` class is essentially `elements.ts` + the `tools/build-data`
generator already written, just needs cleanup.

---

## 2. Full timeline

| When (`LastWriteTime`) | File | What happened |
|---|---|---|
| 2023-12-31 22:32 | `field_rotation.py` | Earliest file. Unrelated 2-line sketch of parallactic/field-rotation rate — not connected to any real function, never revisited. |
| 2024-01-01 23:50 | `test.py` | Cartopy + Natural Earth + Texas DOT/XCSoar shapefile plumbing test (Dallas-area roads/towns). No eclipse math. |
| 2024-01-02 21:22 | `skyfield_test1.py` | First Skyfield use. Consumes a **copied published polynomial table**; separately learns to find the sub-shadow point on Earth via Skyfield for map centering. |
| 2024-01-02 21:45 | `bessel_test1.py` | Same evening, 23 min later. Turns the above into a working loop (3 time offsets) drawing l1/l2 shadow circles over a cartopy Orthographic basemap — still the copied table, `np.polyval` only. |
| *(≈10-week gap — no eclipse-code activity Jan 3 – Mar 10)* | | |
| 2024-03-11 00:10 | `own_bessels.py` | **First self-computation.** Computes x, y, d, l1, l2, µ0, tanf1, tanf2 directly from `de440s.bsp` via Skyfield at 57 points (±2h), using the Sun−Moon geocentric-vector method (this becomes `bessels_at`). Immediately re-fits a degree-3 polynomial to 5 subsampled points per element and plots/prints coefficients, purely to sanity-check the fit — not used further. |
| 2024-03-16 17:45 | `own_bessels2.py` | Drops the polynomial idea. Computes the same per-instant formula on a **dense 1-second grid** (≈3900 points, 18:00–19:05) for a single fixed observer (Dallas), switches ephemeris to `de431t.bsp` (long time-span kernel). |
| 2024-03-16 23:18 | `plots.py` | Created empty (0 bytes) — never used. |
| 2024-03-16 23:32 | `own_bessels3.py` | Single-instant ephemeris evaluation feeding a large **hand-rolled 3D perspective-projection visualizer** (custom `project()`, planes, shadow-cone circles) — geometry-intuition tool, not reusable math. |
| 2024-03-18 20:04 | `own_bessels4.py` | Same idea, redone with real `matplotlib` 3D (`Poly3DCollection`) instead of the hand-rolled projector — a cleaner second pass at the same visualization. |
| 2024-03-18 23:59 | `own_bessels5.py` | **First file to `import` from `calculations.py`** (`bessels_at`, `RE`) — confirms the library module already existed and worked by this point. Drives a full animated shadow movie (`writer_test.mp4` via `FFMpegWriter`, one frame/minute across the whole event). |
| 2024-03-21 19:16 | `bessels_testing_1.py` | Runs `calculations.bessels_at` across the **whole year 2024** with `find_minima` to auto-locate the eclipse instant — confirms the function is stable over long, coarse spans, not just near the known eclipse. |
| 2024-03-22 23:52 | `own_bessels6.py` | Imports `local_bessels_at`, `maximum_time`, `contact_times` from `calculations.py` — confirms those exist by now. Sketches a small `umbral_distance(t, location, kind)` helper (functionally redundant with what's already in `calculations.py`). |
| 2024-03-23 21:24 | `northsouth_tests.py` | Uses `calculations.central_line_at`/`maximum_time`/`contact_times` to color a lat/lon grid by whether C2 exists there — a crude visual umbral-width check. |
| 2024-03-24 10:45 | `occurrence.py` | Unrelated: plots the Moon's ecliptic latitude over 1000 days — occurrence-style sketch, not circumstances. |
| 2024-03-24 23:31 | `calculations.py` | Last edit in this stretch — almost certainly when `central_elements`/`central_line_at` and `bessel_derivs`/`central_duration_width` (Savitzky-Golay derivatives + Mikhailov 1931 duration/width) were added, since `aux_bessels.py` uses exactly those two days later. |
| 2024-03-26 22:35 | `aux_bessels.py` | Prototypes the **N/S umbral limit lines** via iterative Brent/Newton solve of a tangency condition (angle Q, zeta fixed-point iteration) — but hardcoded to **one instant** (`2024-04-08 18:40`), not generalized. Still 100% ephemeris-direct. |
| 2024-03-27 02:21 | `Q_testaus.py` | Unrelated tan/cos plotting sketch. |
| 2024-03-28 01:33 / 09:11 | `eclipse2.js` | **Not authored code** — a saved copy of the client-side JavaScript from `ytliu.epizy.com/eclipse/` (see §5 below). Downloaded right in the middle of the N/S-limits struggle. |
| 2024-03-28 22:46 | `ellipse_test.py` | Unfinished rational parametrization of a circle/ellipse (`(1-t²)/(1+t²)`, `2t/(1+t²)`), not wired to real data — plausibly inspired by looking at ytliu's own outline math the same day, but never connected to it. |
| 2024-04-02 23:33 | `qt_test.py` | Unrelated PyQt5 + matplotlib canvas-embedding demo — no eclipse content at all, an abandoned detour into a native GUI. |
| 2024-04-07 14:12 | `polynom_bessels.py` | **The big one** — `raw_bessels_at` (ephemeris-direct, copied from `calculations.py`) wrapped by the `Bessels` class, which fits a degree-3 polynomial from 5 ephemeris samples and evaluates that from then on. Also adds the two hardest missing pieces: `shadow_outlines` (full footprint polygon) and a generalized, vectorized `shadow_limits` (supersedes `aux_bessels.py`'s single-instant version), plus `solve_gamma`/`rise_set_curves`/`terminator_events` (sunrise/sunset-limited path edges). |
| 2024-04-08 19:49 | `gps_test.py` | The only end-to-end consumer: reads real serial NMEA (`$GPGGA`, position only) from a GPS receiver, feeds the averaged fix into `polynom_bessels.Bessels(...).contact_times()`, writes C1/C2/MAX/C3/C4 to JSON. Confirms `Bessels`, not `calculations.py` directly, was the final interface. |
| 2024-04-21 00:46 | `search_events.py` | Unrelated problem: year-long occurrence search via Skyfield's `almanac.oppositions_conjunctions`/`moon_nodes` (does an eclipse happen near this date), not circumstances of a known one. |
| 2024-04-22 21:15 | `search_events2.py` | Same idea, more refined (new-moon + ecliptic-latitude-window filtering). Imports `skyfield.eclipselib` but never calls it — a dead import, worth knowing that Skyfield's own built-in eclipse predictor exists and was never evaluated as an alternative. |
| 2024-04-25 21:40 / 21:50 | `limb/read_lola.py`, `limb/read_jp2.py` | Last dated activity in the codebase. Unrelated to path/circumstances geometry: reads LRO/LOLA lunar terrain rasters to extract a limb-height profile — groundwork for grazing-occultation/Baily's-beads work, not in the current app's scope. |

`limb/dl_radiantdrift.py`'s timestamp is not evidentiary — it now reads
2026-07-11 because I edited it this session to move its hardcoded API key
into a gitignored file (see the earlier conversation turn); before that edit
it would have sat in the same April-2024 cluster as `read_lola.py`/`read_jp2.py`.

---

## 3. The `own_bessels*` lineage specifically

Since these numbered files are the clearest case of "the same calculation
copied and rewritten," here's the lineage as a chain rather than a table:

```
own_bessels.py    ephemeris → own polyfit (validation only, dead end)
      │
      ▼ (polyfit idea dropped)
own_bessels2.py   ephemeris, dense 1s grid, single observer (Dallas)
      │
      ├─ own_bessels3.py   ephemeris @ 1 instant → hand-rolled 3D viz
      └─ own_bessels4.py   ephemeris @ 1 instant → matplotlib 3D viz (cleanup of #3)
      │
      ▼ (extracted into calculations.py somewhere in this window)
own_bessels5.py   imports calculations.bessels_at → animated shadow movie
      │
own_bessels6.py   imports calculations.local_bessels_at/maximum_time/contact_times
                  → diagnostic plots + a redundant umbral_distance() helper
```

Each file duplicates the core x/y/z/l1/l2/µ0/tanf1/tanf2 formula almost
verbatim (copy-pasted, not imported) through `own_bessels4.py`; only from
`own_bessels5.py` onward does the code actually `import` it from
`calculations.py` instead of re-pasting it. `calculations.py` itself is
never one of the numbered files — it's the cleanup/extraction that happened
*during* this sequence, evidenced by which functions each `own_bessels*.py`
is able to import at each point in time.

`polynom_bessels.py` is a second, later fork of the same core formula
(`raw_bessels_at` vs `calculations.py`'s `bessels_at` — compare them and
they're line-for-line identical except for the function name), not a further
numbered iteration — it re-imports `calculations.py` for a few names
(`RE`, `local_elements`, `dallas`, `central_elements`) but only actually uses
`RE`; the other three imports are dead (it reimplements private equivalents
`_local_elements`/`_aux1_elements`/`central_line_elements` instead),
suggesting `polynom_bessels.py` started as a copy of `calculations.py` that
was then diverged and never cleaned of the unused imports.

---

## 4. Have / partial / missing vs. `PYTHON_REVIEW_BRIEF.md` §1–4

| Item | Status | Where |
|---|---|---|
| C1–C4, totality existence | **Have** | `calculations.contact_times` / `Bessels.contact_times` — Skyfield `find_discrete` bisection, not Newton-on-l1/l2 as PLAN.md §4 assumes (see §6) |
| Totality duration | **Have** | C3−C2 |
| Magnitude / obscuration at max | **Missing** | Not present anywhere in the ~23 files read |
| Sun/Moon alt-az, continuous | **Missing** | Not exposed by any module; trivial to add via Skyfield directly, but no existing function |
| Position / parallactic angle | **Missing** | `shadow_outlines`'s Q is a related-but-different angle (position on the umbra footprint, not the Sun's limb) |
| Angular semi-diameters | **Missing** | `ds`/`k1`/`k2` exist only as Besselian input constants, never converted to apparent arcsec |
| Central line + N/S limits, time series | **Have** | `calculations.central_elements` (central line) + `polynom_bessels.shadow_limits` (generalizes `aux_bessels.py`'s single-instant prototype) |
| Umbral shadow outline (footprint polygon) | **Have, prototype-grade** | `polynom_bessels.shadow_outlines` — globals, debug prints, not cleaned up, but algorithmically real |
| Penumbral limits | **Have** | Same functions, `umbra=False` path |
| Sunset/sunrise-limited path edges | **Have, bonus** | `solve_gamma`/`rise_set_curves`/`terminator_events` — directly relevant since Spain's event is sunset-limited |
| Continuous Sun/Moon sky positions | **Have indirectly** | Underlying Skyfield calls exist everywhere; no dedicated "RA/Dec at t" convenience function |
| ΔT / TD↔UT | **Have, but not a fixed constant** | See §6 |
| Newton iteration / tolerance | **N/A, different method** | Skyfield bisection search throughout, tolerance set via `step_days`, not a convergence epsilon |

---

## 5. `eclipse2.js` — not your code, needs a decision

This 1.8 MB, 114,641-line file is **not hand-written** — it's a saved copy of
the minified client-side JavaScript from `ytliu.epizy.com/eclipse/`
(confirmed by `current_host = "http://ytliu.epizy.com/eclipse/"` and
functions like `loadBess`/`changeEphemeris(431|441)` in the source, plus
large embedded country/province boundary coordinate arrays for its own map).
This is very likely where the ytliu/DE441 cross-check numbers in
`PYTHON_REVIEW_BRIEF.md` §0 originally came from — you probably saved the
page to study how they solve the same central-line/limits/outline problem.

Two things worth knowing:
1. **It's now sitting in the git history** I created earlier this session —
   I staged and committed it along with everything else without opening it
   first, which in hindsight I should have caught given its size. Nothing has
   been pushed anywhere, so this is still easy to undo.
2. **It's third-party code**, saved from someone else's website with no
   accompanying license grant that I can see. Redistributing it (e.g. if this
   repo is ever pushed publicly, or referenced from the new app's repo) would
   be a copyright concern independent of whether it's technically useful.

I'd suggest removing it from git tracking now, before anything is pushed —
happy to do that (either drop it from the last commit since it's still local
and unpushed, or remove it in a new commit) once you say which. If it's
useful as a reference for the shadow-outline/limits math, keeping the file
on disk but untracked (gitignored) preserves that without the licensing
question.

---

## 6. Other findings carried forward / refined from the first pass

- **ΔT is not a fixed constant anywhere in the Python.** Every ephemeris call
  goes through Skyfield's own timescale, which uses its bundled ΔT
  prediction internally — there's no `delta_t = 75.4` constant to find.
  Skyfield's ΔT for 2026-08-12 is ≈68.8s, close to the brief's ytliu/DE441
  cross-check (69.2s) but 6.6s off PLAN.md §15's locked NASA SEdata value
  (75.4s), which is why the earlier spot-check matched the ytliu-sourced
  central-line table to ~200–400m. This is a real decision for the app: if
  `elements.ts` locks to NASA's 75.4s as currently planned, it will disagree
  with its own designated oracle (this Python) by a few km on the ground.
- **Contact-time solving is bisection (`find_discrete`/`find_minima`) over the
  raw ephemeris-driven or polynomial-driven distance function, not Newton
  iteration on l1/l2** as `PLAN.md` §4 describes for `localCircumstances.ts`.
  Not a blocker, but the port needs to pick one deliberately, and validate
  against the Python's actual (bisection) answers either way.
- **`calculations.bessels_at()` requires a vectorized `Time`**, not a bare
  scalar — it builds a `pandas.DataFrame` from `t.utc_datetime()`, which
  throws on a non-array-like `t`. Every caller in the codebase works around
  this by always passing arrays. Worth knowing before writing
  `tools/gen-vectors` against these functions.
- **Nothing computes magnitude, obscuration, position angle, parallactic
  angle, or angular semi-diameters** anywhere in the codebase — confirmed
  after reading every file, not just a sample. This is net-new work for the
  port.
- **Environment is ready and offline-safe.** The `eclipse` conda env
  (skyfield 1.45, numpy 1.26.4, pandas 2.2.1, scipy 1.11.3) runs both
  `calculations.py` and `polynom_bessels.py` with no network access —
  consistent with the app's offline-first mandate.

---

## 7. Porting recommendation

Treat `polynom_bessels.py` as the primary source for `src/eclipse/*.ts`, not
`calculations.py` alone — it has the two hardest pieces (shadow outline,
polynomial-fit generator) already solved, even if messy. `calculations.py`
is the cleaner reference for the underlying per-instant formula and is a
good cross-check/oracle target, but `polynom_bessels.Bessels` is closer in
shape to what `elements.ts` + `tools/build-data`'s Besselian-element
generator actually need to become. Surface the ΔT decision (§6) explicitly
before locking `besselian-2026.json` generation, since it changes the
central-line position by a few km depending on which value wins.
