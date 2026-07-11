"""Generate app/src/data/shadow-frames.json -- central line, N/S umbral
limits, and their terminator-crossing endpoints (PLAN.md Sec3 item 4).

Replaces app/scripts/generate-shadow-frames.ts: this static geometry
(not observer- or clock-dependent) is generated directly from
eclipse-calc, the ground-truth oracle, rather than maintained as a
parallel TypeScript port. Run manually:

    cd tools/build-data && python generate_shadow_frames.py

Needs eclipse-calc installed (pip install -e ../../../eclipse-calc,
PLAN.md Sec11) and a DE440s ephemeris kernel -- point
ECLIPSE_CALC_EPHEMERIS at one, or it falls back to the known-local copy
in the research sandbox. Commit the output JSON when eclipse-calc's
math changes.

Fixed 1s grid for now, no adaptive refinement near the terminator yet
(a deliberate first step -- see docs/PLAN.md) -- each line also gets
ONE extra terminator-crossing point appended, found by:
  - central line: root-finding where the shadow axis's own (ksi, eta)
    leaves the visible disk as seen along the shadow axis, i.e.
    1 - ksi^2 - eta1^2 = 0 (which -- since that axis points roughly
    sunward -- is the day/night terminator itself).
  - N/S limits: shadow_limits' tangent search fails to converge at
    almost exactly the same instant the shadow's edge circle starts
    crossing the terminator (eclipse_calc.terminator.rise_set_curves) --
    confirmed empirically (both transitions land on the same 1s grid
    sample near 18:30:38 UT for the north limit). Of rise_set_curves'
    two crossing points, the one whose angle Q is closer to that limit's
    own convention (~180 deg for north, ~0 deg for south, per
    shadow_limits' L*cos(q)>0 => south rule) is picked.
"""

import json
import os
from pathlib import Path

import numpy as np
from scipy.optimize import brentq
from skyfield.api import load

from eclipse_calc import BesselianEclipse, load_ephemeris
from eclipse_calc.terminator import rise_set_curves, solve_gamma

DEFAULT_EPHEMERIS = Path(r"C:\Users\lauri.kangas\OneDrive\python\eclipse\de440s.bsp")
OUTPUT = Path(__file__).resolve().parent.parent.parent / "app" / "src" / "data" / "shadow-frames.json"

# Spans the shadow's Spain transit with margin either side of the known
# ~0.32-0.56h umbral window (PLAN.md Sec1).
WINDOW_START_H = 0.25
WINDOW_END_H = 0.60
STEP_SECONDS = 1

NORTH_Q_RAD = np.pi
SOUTH_Q_RAD = 0.0


def round5(x):
    return round(float(x), 5)


def ang_dist(a, b):
    d = abs(a - b) % (2 * np.pi)
    return min(d, 2 * np.pi - d)


def utc_ms(skyfield_time):
    return int(skyfield_time.utc_datetime().timestamp() * 1000)


def first_nan_index(values):
    nan_mask = ~np.isfinite(values)
    return int(np.argmax(nan_mask)) if nan_mask.any() else None


def edge_terminator_point(t0, eclipse, hours, first_bad_idx, expected_q):
    """The one terminator-crossing point (lat/lon/utMs) closest in angle
    to `expected_q`, scanning a few grid steps at/after `first_bad_idx`
    in case the exact failure instant has no crossing yet."""
    if first_bad_idx is None or first_bad_idx == 0:
        return None
    for idx in range(first_bad_idx, min(first_bad_idx + 5, len(hours))):
        t = t0.ts.tt_jd(t0.tt + hours[idx] / 24)
        B = eclipse.elements_at(t, derivatives=True)
        gamma = solve_gamma(B, umbra=True)
        if "Y1" not in gamma.columns or not np.isfinite(gamma.Y1.iloc[0]):
            continue
        curves = rise_set_curves(B, umbra=True, append=False)
        row = curves.iloc[0]
        candidates = [(row.Q1, row.lat1, row.lon1), (row.Q2, row.lat2, row.lon2)]
        q, lat, lon = min(candidates, key=lambda c: ang_dist(c[0], expected_q))
        return {"lat": round5(lat), "lon": round5(lon), "utMs": utc_ms(t)}
    return None


def central_line_terminator_point(t0, eclipse, hours, first_bad_idx):
    if first_bad_idx is None or first_bad_idx == 0:
        return None

    def margin(t_hours):
        t = t0.ts.tt_jd(t0.tt + t_hours / 24)
        row = eclipse.elements_at(t, derivatives=False).iloc[0]
        eta1 = row.y / row.rho1
        return 1 - row.x**2 - eta1**2

    lo_h, hi_h = hours[first_bad_idx - 1], hours[first_bad_idx]
    root_h = brentq(margin, lo_h, hi_h)
    t = t0.ts.tt_jd(t0.tt + root_h / 24)
    row = eclipse.central_line(t).iloc[0]
    if not np.isfinite(row.lat):
        # brentq's root can land a hair on the wrong side of the sqrt
        # domain at floating-point precision -- nudge back toward the
        # known-good side.
        t = t0.ts.tt_jd(t0.tt + (root_h - 1e-7) / 24)
        row = eclipse.central_line(t).iloc[0]
    return {"lat": round5(row.lat), "lon": round5(row.lon), "utMs": utc_ms(t)}


def main():
    eph_path = Path(os.environ.get("ECLIPSE_CALC_EPHEMERIS", DEFAULT_EPHEMERIS))
    eph = load_ephemeris(eph_path)
    ts = load.timescale()
    t0 = ts.tt(2026, 8, 12, 18, 0, 0)
    eclipse = BesselianEclipse(t0, eph)

    hours = np.arange(WINDOW_START_H, WINDOW_END_H, STEP_SECONDS / 3600)
    t = t0.ts.tt_jd(t0.tt + hours / 24)
    ut_ms = [int(dt.timestamp() * 1000) for dt in t.utc_datetime()]

    central = eclipse.central_line(t)
    limits = eclipse.shadow_limits(t, umbra=True)

    central_line = [
        {"lat": round5(central.lat.iloc[i]), "lon": round5(central.lon.iloc[i]), "utMs": ut_ms[i]}
        for i in range(len(hours))
        if np.isfinite(central.lat.iloc[i])
    ]
    north_limit = [
        {"lat": round5(limits.N_lat.iloc[i]), "lon": round5(limits.N_lon.iloc[i])}
        for i in range(len(hours))
        if np.isfinite(limits.N_lat.iloc[i])
    ]
    south_limit = [
        {"lat": round5(limits.S_lat.iloc[i]), "lon": round5(limits.S_lon.iloc[i])}
        for i in range(len(hours))
        if np.isfinite(limits.S_lat.iloc[i])
    ]

    central_line_terminator = central_line_terminator_point(
        t0, eclipse, hours, first_nan_index(central.lat.values)
    )
    north_limit_terminator = edge_terminator_point(
        t0, eclipse, hours, first_nan_index(limits.N_lat.values), NORTH_Q_RAD
    )
    south_limit_terminator = edge_terminator_point(
        t0, eclipse, hours, first_nan_index(limits.S_lat.values), SOUTH_Q_RAD
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            {
                "event": "2026-08-12 total solar eclipse, Spain -- map path/shadow frames",
                "generated_by": "eclipse-calc 0.1.0, tools/build-data/generate_shadow_frames.py",
                "windowStartH": WINDOW_START_H,
                "windowEndH": WINDOW_END_H,
                "stepSeconds": STEP_SECONDS,
                "centralLine": central_line,
                "centralLineTerminator": central_line_terminator,
                "northLimit": north_limit,
                "northLimitTerminator": north_limit_terminator,
                "southLimit": south_limit,
                "southLimitTerminator": south_limit_terminator,
            },
            indent=2,
        )
    )
    print(
        f"Wrote {OUTPUT} (centralLine={len(central_line)}, "
        f"northLimit={len(north_limit)}, southLimit={len(south_limit)}, "
        f"terminators: central={central_line_terminator is not None}, "
        f"north={north_limit_terminator is not None}, south={south_limit_terminator is not None})"
    )


if __name__ == "__main__":
    main()
