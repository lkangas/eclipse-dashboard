"""Generate app/src/data/eclipse-times.json -- the whole-event "global
circumstances" table (the standard "Eclipse Times" table published by
every eclipse calculator: ytliu.epizy.com, NASA GSFC/EclipseWise, etc.),
for the 2026-08-12 total solar eclipse. Unlike shadow-frames.json /
shadow-frames-global.json (dense polylines for map rendering), this is
a short list of ~11 single instants describing the whole event, not
tied to any one observer.

The 16-row canonical table is P1, SP1, U1, SU1, C1, NU1, U2, CM, GE,
U3, NU2, C2, SU2, U4, SP2, P4. This script omits FIVE of those and
documents each in the "omitted" array below rather than writing a
number known to be wrong:

  - CM ("central eclipse at local apparent midnight") -- a polar-
    eclipse-specific event, out of scope here (deferred by request).
  - SP1/SP2 (extreme south limit of the PENUMBRA, early/late) --
    `shadow_limits(umbra=False)` is explicitly documented as unreliable
    (shadow.py's own docstring) and this was confirmed empirically: its
    "south" tangent search doesn't even start converging until 16:23 UT
    and 19:15 UT respectively, tens of minutes and tens of degrees away
    from SP1's actual ~16:01:34 UT / SP2's ~19:30:34 UT -- not a
    near-miss, a genuine non-convergence gap. Its "north" tangent
    search never converges anywhere across the whole event, consistent
    with the standard table only ever listing a south penumbral limit
    for this eclipse.
  - SU1/NU1 (extreme south/north limit of the UMBRA, *early* only --
    the late pair NU2/SU2 below is fine, see next paragraph) --
    PLAN.md's brief for this script asserted these are already exactly
    `southLimitTerminatorStart`/`northLimitTerminatorStart` in the
    already-committed shadow-frames-global.json, matching ytliu "to the
    same precision both sources publish". Checked directly against the
    ytliu.epizy.com reference table (see the module docstring's ground-
    truth block in the originating task, or PYTHON_REVIEW_FINDINGS.md):
    it does NOT hold for the *early* pair -- time and longitude land
    within a few seconds/hundredths of a degree of ytliu's SU1/NU1, but
    latitude is off by 0.68-0.69 degrees (~75km), consistently, on both
    sides. Root cause (confirmed by probing `eclipse_calc.shadow.
    shadow_limits` directly on a fine time grid): its tangent-point
    fixed-point iteration is numerically unstable in the first ~30-40s
    after it starts converging at all this close to this event's
    extreme near-polar (75-77N), terminator-limited start -- it
    "converges" (self-consistent zeta fixed point) but visibly drifts
    onto the right track only well after the point ytliu reports, not
    at it. An independent cross-check (taking the northmost/southmost
    point of a dense `shadow_outlines` sweep at ytliu's own stated SU1
    instant) lands at yet another value, disagreeing with both
    `shadow_limits` *and* ytliu -- three independent readings that
    don't agree confirms this isn't a stale/coarse-grid artifact of
    the existing generator script, but a real accuracy limit of the
    underlying tangent search this close to the pole.

    The trailing pair (NU2/SU2, `...LimitTerminatorEnd`) is NOT
    affected -- that end of the path is at ordinary mid-latitude
    (37-40N), matches ytliu to ~0.06 degrees / ~10s, and is used below.

For the rows that DO check out (see the verification table in the
originating task's final report), this script:

  - reuses `eclipse.terminator_events()` (already existing, already
    unit-tested against a reference for CE1/CE2 in eclipse-calc's own
    test suite) for P1, U1, U2, U3, U4, P4 -- its `edge_sign`/
    `find_discrete` radial approximation (checking the shadow circle's
    outer/inner edge against Earth's limb along the ray to the shadow
    center, rather than a full nested angular search) turns out to
    already match ytliu to ~0.005 degrees / ~1s across the board, so
    the more elaborate nested-optimizer contact search sketched in the
    originating task brief wasn't needed -- this primitive already
    existed and already does the job;
  - pulls C1/C2 (`centralLineTerminatorStart`/`End`) and NU2/SU2
    (`northLimitTerminatorEnd`/`southLimitTerminatorEnd`) straight out
    of the already-committed shadow-frames-global.json, per the
    originating brief -- not recomputed;
  - computes GE (greatest eclipse) as a plain 1D minimization of
    x(t)^2 + y(t)^2 (shadow axis distance from Earth's center) over the
    cached Besselian polynomial, no ellipsoid needed; lat/lon of the
    sub-shadow point at that instant reuses `central_line`.

Run manually:

    cd tools/build-data && python generate_eclipse_times.py

Needs eclipse-calc installed (pip install -e ../../../eclipse-calc,
PLAN.md Sec11), a DE440s ephemeris kernel (ECLIPSE_CALC_EPHEMERIS env
var, else the known-local research-sandbox copy), and the
already-committed app/src/data/shadow-frames-global.json (read, not
regenerated). Commit the output JSON when eclipse-calc's math changes.
"""

import json
import os
from pathlib import Path

from scipy.optimize import minimize_scalar
from skyfield.api import load

import eclipse_calc
from eclipse_calc import BesselianEclipse, load_ephemeris

DEFAULT_EPHEMERIS = Path(r"C:\Users\lauri.kangas\OneDrive\python\eclipse\de440s.bsp")
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "app" / "src" / "data"
SHADOW_FRAMES_GLOBAL = DATA_DIR / "shadow-frames-global.json"
OUTPUT = DATA_DIR / "eclipse-times.json"

# Bracket for the greatest-eclipse minimization, hours from T0 -- wide
# enough to safely contain the true minimum (~-0.23h from T0 for this
# event) with margin, narrow enough to stay inside the +/-3h polynomial
# fit's solid (non-extrapolated) range (see polynomial.py).
GE_SEARCH_BRACKET_H = (-1.0, 1.0)


def round5(x):
    return round(float(x), 5)


def utc_ms(skyfield_time):
    return int(skyfield_time.utc_datetime().timestamp() * 1000)


def event_from_terminator_row(row):
    return {"utMs": int(row.time.timestamp() * 1000), "lat": round5(row.lat), "lon": round5(row.lon)}


def event_from_shadow_frames_point(point):
    return {"utMs": point["utMs"], "lat": point["lat"], "lon": point["lon"]}


def compute_greatest_eclipse(t0, eclipse):
    def dist2(hours):
        t = t0.ts.tt_jd(t0.tt + hours / 24)
        row = eclipse.elements_at(t, derivatives=False).iloc[0]
        return row.x**2 + row.y**2

    result = minimize_scalar(
        dist2, bounds=GE_SEARCH_BRACKET_H, method="bounded", options={"xatol": 1e-10}
    )
    t_ge = t0.ts.tt_jd(t0.tt + result.x / 24)
    central = eclipse.central_line(t_ge).iloc[0]
    return {"utMs": utc_ms(t_ge), "lat": round5(central.lat), "lon": round5(central.lon)}


def main():
    eph_path = Path(os.environ.get("ECLIPSE_CALC_EPHEMERIS", DEFAULT_EPHEMERIS))
    eph = load_ephemeris(eph_path)
    ts = load.timescale()
    t0 = ts.tt(2026, 8, 12, 18, 0, 0)
    eclipse = BesselianEclipse(t0, eph)

    terminator = eclipse.terminator_events()
    shadow_frames_global = json.loads(SHADOW_FRAMES_GLOBAL.read_text())

    events = [
        {
            "key": "p1",
            "label": "First external contact of penumbra with Earth",
            **event_from_terminator_row(terminator.loc["P1"]),
        },
        {
            "key": "u1",
            "label": "First external contact of umbra with Earth",
            **event_from_terminator_row(terminator.loc["U1"]),
        },
        {
            "key": "c1",
            "label": "Beginning of central line (shadow axis first touches Earth)",
            **event_from_shadow_frames_point(shadow_frames_global["centralLineTerminatorStart"]),
        },
        {
            "key": "u2",
            "label": "First internal contact of umbra (umbra fully on Earth)",
            **event_from_terminator_row(terminator.loc["U2"]),
        },
        {
            "key": "ge",
            "label": "Greatest eclipse (shadow axis closest to Earth's center)",
            **compute_greatest_eclipse(t0, eclipse),
        },
        {
            "key": "u3",
            "label": "Last internal contact of umbra (umbra about to leave Earth)",
            **event_from_terminator_row(terminator.loc["U3"]),
        },
        {
            "key": "nu2",
            "label": "Extreme northern limit of umbra, late (north limit line's end)",
            **event_from_shadow_frames_point(shadow_frames_global["northLimitTerminatorEnd"]),
        },
        {
            "key": "c2",
            "label": "End of central line (shadow axis last touches Earth)",
            **event_from_shadow_frames_point(shadow_frames_global["centralLineTerminatorEnd"]),
        },
        {
            "key": "su2",
            "label": "Extreme southern limit of umbra, late (south limit line's end)",
            **event_from_shadow_frames_point(shadow_frames_global["southLimitTerminatorEnd"]),
        },
        {
            "key": "u4",
            "label": "Last external contact of umbra with Earth",
            **event_from_terminator_row(terminator.loc["U4"]),
        },
        {
            "key": "p4",
            "label": "Last external contact of penumbra with Earth",
            **event_from_terminator_row(terminator.loc["P4"]),
        },
    ]

    omitted = [
        {
            "key": "cm",
            "label": "Central eclipse at local apparent midnight",
            "reason": (
                "Polar-eclipse-specific event, deferred out of scope for this "
                "script by direct request -- not attempted."
            ),
        },
        {
            "key": "sp1",
            "label": "Extreme southern limit of penumbra, early",
            "reason": (
                "shadow_limits(umbra=False)'s tangent search doesn't converge "
                "anywhere near SP1's actual time/place -- its 'south' branch "
                "only starts converging at 16:23 UT (49.35N 125.15W), tens of "
                "minutes and ~40 degrees of longitude away from ytliu's SP1 "
                "(~16:01:34 UT, 43.49N 163.67W); its 'north' branch never "
                "converges anywhere in the event. A genuine non-convergence "
                "gap, not a precision issue -- see shadow.py's own docstring "
                "caveat about umbra=False."
            ),
        },
        {
            "key": "su1",
            "label": "Extreme southern limit of umbra, early",
            "reason": (
                "shadow-frames-global.json's southLimitTerminatorStart lands "
                "close to ytliu's SU1 in time (9s) and longitude (0.12deg) but "
                "0.68deg (~75km) off in latitude. Confirmed via a fine time-grid "
                "probe of eclipse_calc.shadow.shadow_limits directly: its "
                "tangent-point fixed-point iteration is unstable for roughly "
                "the first 30-40s after it starts converging at all this close "
                "to this event's extreme near-polar (~75-77N), terminator-"
                "limited start, and a third independent check (extreme point "
                "of a dense shadow_outlines sweep at ytliu's exact SU1 instant) "
                "disagrees with both. Not reliable enough to report."
            ),
        },
        {
            "key": "nu1",
            "label": "Extreme northern limit of umbra, early",
            "reason": (
                "Same failure mode as su1 above (see that entry) -- "
                "northLimitTerminatorStart matches ytliu's NU1 in time "
                "(exact, to the second) and longitude (0.0014deg) but is "
                "0.69deg (~77km) off in latitude, for the same near-polar "
                "shadow_limits instability. Note the *late* pair (nu2/su2, "
                "included above) is unaffected -- that end of the path is at "
                "ordinary mid-latitude, far from this failure mode."
            ),
        },
        {
            "key": "sp2",
            "label": "Extreme southern limit of penumbra, late",
            "reason": (
                "Mirror of sp1 above -- shadow_limits(umbra=False)'s 'south' "
                "branch stops converging at 19:15 UT (11.68N 51.82W), well "
                "before ytliu's SP2 (~19:30:34 UT, 2.60S 22.08W); its 'north' "
                "branch never converges. Same genuine non-convergence gap."
            ),
        },
    ]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            {
                "event": "2026-08-12 total solar eclipse -- global circumstances (Eclipse Times table)",
                "generated_by": (
                    f"eclipse-calc {eclipse_calc.__version__}, "
                    "tools/build-data/generate_eclipse_times.py"
                ),
                "events": events,
                "omitted": omitted,
            },
            indent=2,
        )
    )
    print(f"Wrote {OUTPUT} ({len(events)} events, {len(omitted)} omitted)")
    for e in events:
        print(f"  {e['key']:4s} {e['label']:60s} utMs={e['utMs']} lat={e['lat']} lon={e['lon']}")


if __name__ == "__main__":
    main()
