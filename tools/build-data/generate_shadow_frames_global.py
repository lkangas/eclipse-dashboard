"""Generate app/src/data/shadow-frames-global.json -- whole-event central
line, N/S umbral limits, and their terminator-crossing endpoints (both
ends), for the small global-overview map.

Sibling of generate_shadow_frames.py, which covers only the Spain-
transit window at a fixed 1s grid for the detail map and is NOT
touched by this script. This one instead:

  - auto-discovers the ENTIRE 2026-08-12 event's umbral window (from
    wherever the shadow first touches the globe to wherever it last
    leaves it) by coarse-scanning a wide range around T0, rather than
    hardcoding a window like the Spain script does;
  - samples that window at a coarser step chosen to keep each line's
    point count in the ~300-1500 range -- plenty for a ~200x200px
    overview thumbnail, not path-accuracy work;
  - unlike the Spain window (which starts safely mid-visible-disk and
    only needs a terminator point at its END), this window can BEGIN
    right at a terminator crossing too -- the umbra's sunrise-side
    first touch of the Earth -- so terminator points are searched for
    at BOTH ends, for all three lines (central, north limit, south
    limit).

Run manually:

    cd tools/build-data && python generate_shadow_frames_global.py

Needs eclipse-calc installed (pip install -e ../../../eclipse-calc,
PLAN.md Sec11) and a DE440s ephemeris kernel -- point
ECLIPSE_CALC_EPHEMERIS at one, or it falls back to the known-local copy
in the research sandbox (same convention as generate_shadow_frames.py).
Commit the output JSON when eclipse-calc's math changes.
"""

import json
import os
from pathlib import Path

import numpy as np
from scipy.optimize import brentq
from skyfield.api import load

import eclipse_calc
from eclipse_calc import BesselianEclipse, load_ephemeris
from eclipse_calc.terminator import rise_set_curves, solve_gamma

DEFAULT_EPHEMERIS = Path(r"C:\Users\lauri.kangas\OneDrive\python\eclipse\de440s.bsp")
OUTPUT = (
    Path(__file__).resolve().parent.parent.parent
    / "app" / "src" / "data" / "shadow-frames-global.json"
)

# Wide coarse-scan range to auto-discover the whole event's umbral
# window. BesselianEclipse's own polynomial fit (see polynomial.py) is
# anchored on samples spanning -3..+3h around T0, so staying inside
# that range keeps the discovery scan on solid (non-extrapolated)
# ground.
DISCOVERY_RANGE_H = 3.0
DISCOVERY_STEP_S = 30

# Small pad applied to the discovered finite union, both ends, so the
# fine-resolution generation pass below has at least one genuinely
# out-of-window (NaN) sample past each real edge to bracket the
# terminator-crossing root-find against.
WINDOW_MARGIN_H = 0.05

NORTH_Q_RAD = np.pi
SOUTH_Q_RAD = 0.0


def round5(x):
    return round(float(x), 5)


def ang_dist(a, b):
    d = abs(a - b) % (2 * np.pi)
    return min(d, 2 * np.pi - d)


def utc_ms(skyfield_time):
    return int(skyfield_time.utc_datetime().timestamp() * 1000)


def finite_span(values):
    """(first, last) index of the contiguous finite run in `values`, or
    None if there's no finite sample at all."""
    finite = np.isfinite(values)
    if not finite.any():
        return None
    idxs = np.where(finite)[0]
    return int(idxs[0]), int(idxs[-1])


def discover_window(t0, eclipse):
    """Coarse-scan +/-DISCOVERY_RANGE_H around T0 to find the whole
    event's umbral window -- the union of the central line's and both
    N/S limits' finite spans. Each line's own valid range differs
    slightly (for the 2026-08-12 event the N/S limits extend a couple
    of minutes past the central line at either end), so the union
    (not just the central line alone) is what actually bounds the
    window this script needs to generate."""
    hours = np.arange(-DISCOVERY_RANGE_H, DISCOVERY_RANGE_H, DISCOVERY_STEP_S / 3600)
    t = t0.ts.tt_jd(t0.tt + hours / 24)

    central = eclipse.central_line(t)
    limits = eclipse.shadow_limits(t, umbra=True)
    n_lat = limits.N_lat.values if "N_lat" in limits else np.full(len(hours), np.nan)
    s_lat = limits.S_lat.values if "S_lat" in limits else np.full(len(hours), np.nan)

    spans = [s for s in (finite_span(central.lat.values), finite_span(n_lat), finite_span(s_lat)) if s]
    if not spans:
        raise RuntimeError(
            f"discover_window: no finite umbral samples found within "
            f"+/-{DISCOVERY_RANGE_H}h of T0 -- widen DISCOVERY_RANGE_H"
        )

    start_h = hours[min(s[0] for s in spans)] - WINDOW_MARGIN_H
    end_h = hours[max(s[1] for s in spans)] + WINDOW_MARGIN_H
    return round(float(start_h), 4), round(float(end_h), 4)


def choose_step_seconds(window_start_h, window_end_h):
    """Pick a step that keeps the point count per line in the ~300-1500
    range appropriate for a small overview thumbnail (the Spain detail
    map's fixed 1s grid would be overkill here) -- finer if the
    discovered window is narrow, coarser if it's wide."""
    width_s = (window_end_h - window_start_h) * 3600
    for step in (10, 15, 20, 30, 60, 120, 300):
        if width_s / step <= 1500:
            return step
    return 600


def leading_bad_index(values):
    """Index of the sample just before the finite run starts (the NaN
    side of the leading terminator-crossing bracket), or None if the
    run already starts at index 0 (no leading edge in this window)."""
    span = finite_span(values)
    if span is None or span[0] == 0:
        return None
    return span[0] - 1


def trailing_bad_index(values):
    """Index of the sample just after the finite run ends (the NaN side
    of the trailing terminator-crossing bracket), or None if the run
    already extends to the last index (no trailing edge in this
    window)."""
    span = finite_span(values)
    if span is None or span[1] == len(values) - 1:
        return None
    return span[1] + 1


def central_line_terminator_point(t0, eclipse, hours, bad_idx, *, direction):
    """The one terminator-crossing point (lat/lon/utMs) for the central
    line, root-finding where the shadow axis's own (ksi, eta) leaves
    the visible disk (see generate_shadow_frames.py's header for the
    derivation).

    `direction=1` for the trailing edge (`bad_idx` is the first NaN
    after the good run; bracket is [bad_idx-1, bad_idx]), `direction=-1`
    for the leading edge (`bad_idx` is the last NaN before the good
    run; bracket is [bad_idx, bad_idx+1])."""
    if bad_idx is None:
        return None
    lo_idx, hi_idx = (bad_idx - 1, bad_idx) if direction > 0 else (bad_idx, bad_idx + 1)
    lo_h, hi_h = hours[lo_idx], hours[hi_idx]
    good_h = lo_h if direction > 0 else hi_h

    def margin(t_hours):
        t = t0.ts.tt_jd(t0.tt + t_hours / 24)
        row = eclipse.elements_at(t, derivatives=False).iloc[0]
        eta1 = row.y / row.rho1
        return 1 - row.x**2 - eta1**2

    root_h = brentq(margin, lo_h, hi_h)
    t = t0.ts.tt_jd(t0.tt + root_h / 24)
    row = eclipse.central_line(t).iloc[0]
    if not np.isfinite(row.lat):
        # brentq's root can land a hair on the wrong side of the sqrt
        # domain at floating-point precision -- nudge back toward the
        # known-good side (whichever end of the bracket that is).
        nudge = 1e-7 if good_h > root_h else -1e-7
        t = t0.ts.tt_jd(t0.tt + (root_h + nudge) / 24)
        row = eclipse.central_line(t).iloc[0]
    return {"lat": round5(row.lat), "lon": round5(row.lon), "utMs": utc_ms(t)}


def edge_terminator_point(t0, eclipse, hours, bad_idx, expected_q, *, direction):
    """The one terminator-crossing point (lat/lon/utMs) closest in angle
    to `expected_q`, scanning a few grid steps from `bad_idx` further
    into the NaN region (`direction=1`: forward/trailing edge;
    `direction=-1`: backward/leading edge) in case the exact failure
    instant has no crossing yet."""
    if bad_idx is None:
        return None
    for idx in range(bad_idx, bad_idx + direction * 5, direction):
        if idx < 0 or idx >= len(hours):
            break
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


def main():
    eph_path = Path(os.environ.get("ECLIPSE_CALC_EPHEMERIS", DEFAULT_EPHEMERIS))
    eph = load_ephemeris(eph_path)
    ts = load.timescale()
    t0 = ts.tt(2026, 8, 12, 18, 0, 0)
    eclipse = BesselianEclipse(t0, eph)

    window_start_h, window_end_h = discover_window(t0, eclipse)
    step_seconds = choose_step_seconds(window_start_h, window_end_h)
    print(
        f"Discovered window: {window_start_h:.4f}h .. {window_end_h:.4f}h from T0 "
        f"({(window_end_h - window_start_h) * 60:.1f} min wide), step={step_seconds}s"
    )

    hours = np.arange(window_start_h, window_end_h, step_seconds / 3600)
    t = t0.ts.tt_jd(t0.tt + hours / 24)
    ut_ms = [int(dt.timestamp() * 1000) for dt in t.utc_datetime()]

    central = eclipse.central_line(t)
    limits = eclipse.shadow_limits(t, umbra=True)
    n_lat = limits.N_lat.values if "N_lat" in limits else np.full(len(hours), np.nan)
    n_lon = limits.N_lon.values if "N_lon" in limits else np.full(len(hours), np.nan)
    s_lat = limits.S_lat.values if "S_lat" in limits else np.full(len(hours), np.nan)
    s_lon = limits.S_lon.values if "S_lon" in limits else np.full(len(hours), np.nan)

    central_line = [
        {"lat": round5(central.lat.iloc[i]), "lon": round5(central.lon.iloc[i]), "utMs": ut_ms[i]}
        for i in range(len(hours))
        if np.isfinite(central.lat.iloc[i])
    ]
    north_limit = [
        {"lat": round5(n_lat[i]), "lon": round5(n_lon[i])}
        for i in range(len(hours))
        if np.isfinite(n_lat[i])
    ]
    south_limit = [
        {"lat": round5(s_lat[i]), "lon": round5(s_lon[i])}
        for i in range(len(hours))
        if np.isfinite(s_lat[i])
    ]

    central_line_terminator_start = central_line_terminator_point(
        t0, eclipse, hours, leading_bad_index(central.lat.values), direction=-1
    )
    central_line_terminator_end = central_line_terminator_point(
        t0, eclipse, hours, trailing_bad_index(central.lat.values), direction=1
    )
    north_limit_terminator_start = edge_terminator_point(
        t0, eclipse, hours, leading_bad_index(n_lat), NORTH_Q_RAD, direction=-1
    )
    north_limit_terminator_end = edge_terminator_point(
        t0, eclipse, hours, trailing_bad_index(n_lat), NORTH_Q_RAD, direction=1
    )
    south_limit_terminator_start = edge_terminator_point(
        t0, eclipse, hours, leading_bad_index(s_lat), SOUTH_Q_RAD, direction=-1
    )
    south_limit_terminator_end = edge_terminator_point(
        t0, eclipse, hours, trailing_bad_index(s_lat), SOUTH_Q_RAD, direction=1
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            {
                "event": (
                    "2026-08-12 total solar eclipse -- whole-event central line + "
                    "N/S limits for the global overview map"
                ),
                "generated_by": (
                    f"eclipse-calc {eclipse_calc.__version__}, "
                    "tools/build-data/generate_shadow_frames_global.py"
                ),
                "windowStartH": window_start_h,
                "windowEndH": window_end_h,
                "stepSeconds": step_seconds,
                "centralLine": central_line,
                "centralLineTerminatorStart": central_line_terminator_start,
                "centralLineTerminatorEnd": central_line_terminator_end,
                "northLimit": north_limit,
                "northLimitTerminatorStart": north_limit_terminator_start,
                "northLimitTerminatorEnd": north_limit_terminator_end,
                "southLimit": south_limit,
                "southLimitTerminatorStart": south_limit_terminator_start,
                "southLimitTerminatorEnd": south_limit_terminator_end,
            },
            indent=2,
        )
    )
    print(
        f"Wrote {OUTPUT} (centralLine={len(central_line)}, "
        f"northLimit={len(north_limit)}, southLimit={len(south_limit)}, "
        f"terminators: centralStart={central_line_terminator_start is not None}, "
        f"centralEnd={central_line_terminator_end is not None}, "
        f"northStart={north_limit_terminator_start is not None}, "
        f"northEnd={north_limit_terminator_end is not None}, "
        f"southStart={south_limit_terminator_start is not None}, "
        f"southEnd={south_limit_terminator_end is not None})"
    )


if __name__ == "__main__":
    main()
