# Python reference code — first-pass summary

This is the initial review pass against `docs/PYTHON_REVIEW_BRIEF.md` (an
agent-run inventory + a live spot-check against the 2026-08-12 event), done
before the closer, timestamp-ordered read in `docs/PYTHON_REVIEW_FINDINGS.md`.
Kept as a separate, shorter record of what was found first and in what order.

---

## Architecture

The codebase isn't a hand-rolled Besselian-polynomial implementation the way
`PLAN.md` §4/§15 assumed — it computes Besselian elements **directly from
Skyfield/JPL DE440s ephemeris** at arbitrary times
(`calculations.py:bessels_at`), then a later, messier file
(`polynom_bessels.py`, 772 lines) *fits* that to the NASA-style
`a0+a1t+a2t²+a3t³` polynomial form. That resolves the open decision in
`PLAN.md` §14 #4 — a working generator for the app's `besselian-2026.json`
already exists, no need to bundle NASA's SEdata.

## Better news than the brief expected

The two things flagged as the biggest unknowns/gaps are both already
prototyped:

- **Umbral/penumbral shadow outline** (the actual footprint polygon, not just
  3 lines) — `polynom_bessels.py:shadow_outlines`
- **N/S limit lines, generalized over a time series** — `polynom_bessels.py:shadow_limits`
  (supersedes `aux_bessels.py`'s single-instant scratch version)
- Bonus: sunset/sunrise-limited path-edge math (`solve_gamma`,
  `rise_set_curves`, `terminator_events`) — directly relevant since Spain's
  event is itself sunset-limited.

Both are prototype-grade (module-level globals, debug prints, `__main__`-only
exploratory code at the bottom) but algorithmically real — this changes
`path.ts` from "derive from scratch" to "clean up and port."

## Confirmed missing

Net-new work for the port, not extractable from Python: **magnitude,
obscuration, position/parallactic angle, Sun/Moon angular semi-diameters**.
None of the ~20 files compute any of these.

## Spot-check against the brief's §0 reference numbers

Run live against the real 2026-08-12 event using the existing `eclipse`
conda env — no setup needed, no network access triggered:

- Zaragoza: 5.907° alt / 83.9s totality vs. reference ~5.9°/~85s — **matches**
- Central-line fixes at 18:18/18:22/18:26/18:30 UT — **match reference to
  ~200–400 m**
- Bonus: Calamocha (the app's actual default site, previously unverified) —
  C2 18:30:10, C3 18:31:52 UT, **101.6s totality**, alt 5.93°, az 284.6°

## ΔT — a real decision for the team

The Python's ΔT is not a fixed constant — it comes from Skyfield's own ΔT
model, ≈68.8s for this date, which is why the spot-check matches the
ytliu/DE441 reference (69.2s) so closely. That's **6.6s off** NASA's SEdata
value (75.4s) that `PLAN.md` §15 currently locks to. Since the Python is
meant to be the source of truth, recommend locking the app's ΔT to whatever
the Python/Skyfield produces rather than NASA's published constant —
otherwise the TS port won't match its own oracle to the tolerances `PLAN.md`
§12 wants.

## Other findings from this pass

- Contact-time solving uses Skyfield's bisection-style `find_discrete`/
  `find_minima`, not the Newton-on-l1/l2 method `PLAN.md` §4 describes — a
  documentation/design mismatch to resolve, not a blocker.
- `gps_test.py` is a real serial-GPS prototype using `$GPGGA` (position only,
  no RMC time) — GPS-disciplined clock from `PLAN.md` §6 has no precedent
  here.
- `limb/dl_radiantdrift.py` had a hardcoded third-party API key (since moved
  to a gitignored file, see the git-init work done this session) — worth not
  carrying into the new repo if that grazing-occultation code is ever
  referenced.

## Superseded/refined by the later pass

The closer read in `docs/PYTHON_REVIEW_FINDINGS.md` adds the full
chronology, traces the `own_bessels1-6` lineage, and identifies
`eclipse2.js` as a saved third-party file rather than authored code — see
that document for the complete picture. This summary is kept as-is for the
record of what the first pass actually found, rather than edited to match.
