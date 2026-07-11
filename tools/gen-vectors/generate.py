"""Generate golden contact-time vectors from the eclipse-calc oracle for
the 2026-08-12 Spain eclipse (PLAN.md Sec4/Sec12). Run manually:

    python tools/gen-vectors/generate.py

Needs eclipse-calc installed (pip install -e ../eclipse-calc, PLAN.md
Sec11) and a DE440s ephemeris kernel -- point ECLIPSE_CALC_EPHEMERIS at
one, or it falls back to the known-local copy in the research sandbox.
Commit the output JSON when eclipse-calc's math changes; the TS port's
Vitest suite reads it, it isn't regenerated at build/test time.
"""

import json
import os
from pathlib import Path

import numpy as np
from numpy import arctan, cos, deg2rad, sin, sqrt, tan
from skyfield.api import load
from skyfield.toposlib import wgs84

from eclipse_calc import BesselianEclipse, Location, load_ephemeris
from eclipse_calc.constants import RE, f
from eclipse_calc.shadow import shadow_limits, shadow_outlines

DEFAULT_EPHEMERIS = Path(r"C:\Users\lauri.kangas\OneDrive\python\eclipse\de440s.bsp")
FIXTURES = Path(__file__).resolve().parent.parent.parent / "app" / "test" / "fixtures"
OUTPUT = FIXTURES / "golden-vectors.json"
ELEMENTS_OUTPUT = FIXTURES / "golden-elements.json"
OBSERVER_OUTPUT = FIXTURES / "golden-observer.json"
LOCAL_ELEMENTS_OUTPUT = FIXTURES / "golden-local-elements.json"
CENTRAL_LINE_OUTPUT = FIXTURES / "golden-central-line.json"
SHADOW_LIMITS_OUTPUT = FIXTURES / "golden-shadow-limits.json"
SHADOW_OUTLINE_OUTPUT = FIXTURES / "golden-shadow-outline.json"

LOCAL_ELEMENTS_COLS = ["x", "y", "d", "mu0", "ksi", "eta", "zeta", "L1", "L2"]
AUX1_COLS = ["rho1", "rho2", "sind1", "cosd1", "sind1d2", "cosd1d2"]

# Besselian elements elements.ts needs to evaluate as a plain degree-3
# polynomial (PLAN.md Sec4) -- excludes `gast`, which BesselianEclipse
# also tracks but isn't part of elements.ts's scope.
ELEMENT_COLS = ["x", "y", "d", "mu0", "l1", "l2", "tanf1", "tanf2"]

# (name, lat_deg, lon_deg, elevation_m) -- PLAN.md Sec1's representative
# Spanish sites, Calamocha (the app's actual default site), and two
# published "just outside the path" sites as negative (partial-only) cases.
SITES = [
    ("A Coruna", 43.36, -8.41, 0),
    ("Oviedo/Gijon", 43.36, -5.85, 0),
    ("Leon", 42.60, -5.57, 0),
    ("Burgos", 42.34, -3.70, 0),
    ("Santander", 43.46, -3.81, 0),
    ("Bilbao", 43.26, -2.94, 0),
    ("Zaragoza", 41.65, -0.89, 0),
    ("Valencia", 39.47, -0.38, 0),
    ("Castellon/Peniscola", 40.36, 0.40, 0),
    ("Palma de Mallorca", 39.57, 2.65, 0),
    ("Calamocha", 40.92, -1.30, 884),
    ("Madrid", 40.4168, -3.7038, 0),
    ("Barcelona", 41.3874, 2.1686, 0),
]


def contact_dict(ct, t0):
    # Truthy-checking a Skyfield Time (`if ct.c1`) falls back to __len__,
    # which raises for a genuinely scalar Time -- must use `is not None`,
    # same as eclipse-calc's own ContactTimes.is_total_or_annular does.
    # *_hours_from_t0 are TT-based, matching elements.ts/localCircumstances.ts's
    # internal time representation directly -- deliberately not going through
    # UTC/DeltaT here, since that's a separate, orthogonal concern (PLAN.md
    # Sec15) from whether the root-finder itself lands on the right instant.
    return {
        "c1": ct.c1.utc_iso() if ct.c1 is not None else None,
        "c2": ct.c2.utc_iso() if ct.c2 is not None else None,
        "c3": ct.c3.utc_iso() if ct.c3 is not None else None,
        "c4": ct.c4.utc_iso() if ct.c4 is not None else None,
        "c1_hours_from_t0": (ct.c1.tt - t0.tt) * 24 if ct.c1 is not None else None,
        "c2_hours_from_t0": (ct.c2.tt - t0.tt) * 24 if ct.c2 is not None else None,
        "c3_hours_from_t0": (ct.c3.tt - t0.tt) * 24 if ct.c3 is not None else None,
        "c4_hours_from_t0": (ct.c4.tt - t0.tt) * 24 if ct.c4 is not None else None,
        "is_total": ct.is_total_or_annular,
        "duration_s": (ct.c3.tt - ct.c2.tt) * 86400 if ct.is_total_or_annular else None,
    }


def elements_fixture(eclipse, ts, t0):
    """Coefficients (ascending power order, a0..a3) plus a few sampled
    per-instant evaluations -- the latter is an independent cross-check
    that elements.ts's own a0+a1*t+a2*t^2+a3*t^3 evaluation (using the
    coefficients alone) lands on the same numbers, not just a re-
    derivation from the same coefficients it's meant to validate."""
    coeffs = {col: eclipse._coeffs[col].tolist() for col in ELEMENT_COLS}

    samples = []
    for hours in (-2, -1, 0, 1, 2):
        t = ts.tt_jd(t0.tt + hours / 24)
        # elements_at recomputes t_hours as (t - t0) * 24, which round-trips
        # through Julian-date floating point and isn't exactly `hours` (off
        # by ~3.7e-9h/13us) -- record the value it actually used, not the
        # requested one, so a consumer evaluating at this exact t matches
        # to full float precision instead of ~1e-9 short of it.
        actual_t_hours = (t.tt - t0.tt) * 24
        row = eclipse.elements_at(t, derivatives=True).iloc[0]
        samples.append({
            "t_hours_from_t0": actual_t_hours,
            **{col: float(row[col]) for col in ELEMENT_COLS},
            **{f"d_{col}": float(row[f"d_{col}"]) for col in ELEMENT_COLS},
        })

    return {
        "generated_by": "eclipse-calc 0.1.0",
        "t0_tt": "2026-08-12T18:00:00 TD",
        "note": "coefficients are ascending power order [a0, a1, a2, a3]; t is hours from t0",
        "coefficients": coeffs,
        "samples": samples,
    }


def observer_fixture():
    """rho*sin(geocentric_lat) / rho*cos(geocentric_lat) per site, computed
    the same way eclipse_calc.observer.local_elements does (same constants,
    same Skyfield WGS84 call) -- authoritative, not a re-derivation."""
    sites_out = {}
    for name, lat, lon, elev in SITES:
        lat_rad = deg2rad(lat)
        geocentric_lat = arctan((1 - f) ** 2 * tan(lat_rad))
        position = wgs84.latlon(lat, lon, elevation_m=elev)
        rho = sqrt((position.itrs_xyz.m ** 2).sum()) / RE
        sites_out[name] = {
            "lat": lat,
            "lon": lon,
            "elevation_m": elev,
            "rho": float(rho),
            "geocentric_lat_rad": float(geocentric_lat),
            "rho_sin_phi_prime": float(rho * np.sin(geocentric_lat)),
            "rho_cos_phi_prime": float(rho * np.cos(geocentric_lat)),
        }
    return {
        "generated_by": "eclipse-calc 0.1.0 (eclipse_calc.observer.local_elements, rho/geocentric_lat steps)",
        "note": "geocentric_lat ignores elevation by design (matches eclipse-calc); rho includes it via full WGS84 XYZ",
        "sites": sites_out,
    }


def local_elements_fixture(eclipse, ts, t0):
    """ksi/eta/zeta/L1/L2 -- the ingredients of the contact-time search's
    signed distance function -- at a handful of (site, t) combinations,
    for verifying localCircumstances.ts's local-elements glue before
    building the root-finder on top of it."""
    sites = {
        "Zaragoza": (41.65, -0.89, 0),
        "Calamocha": (40.92, -1.30, 884),
        "Madrid": (40.4168, -3.7038, 0),  # outside the path -- sanity check
    }
    cases = []
    for name, (lat, lon, elev) in sites.items():
        loc = Location(lat_deg=lat, lon_deg=lon, elevation_m=elev)
        for hours in (-1, -0.5, 0, 0.5, 1):
            t = ts.tt_jd(t0.tt + hours / 24)
            actual_t_hours = (t.tt - t0.tt) * 24
            row = eclipse.elements_at(t, location=loc, derivatives=False).iloc[0]
            cases.append({
                "site": name, "lat": lat, "lon": lon, "elevation_m": elev,
                "t_hours_from_t0": actual_t_hours,
                **{col: float(row[col]) for col in LOCAL_ELEMENTS_COLS},
            })
    return {
        "generated_by": "eclipse-calc 0.1.0 (BesselianEclipse.elements_at with location=)",
        "cases": cases,
    }


def central_line_fixture(eclipse, ts, t0):
    """Central-line lat/lon (+ aux1_elements' d-dependent quantities) at
    1-min steps across the Spain-crossing window -- covers the same
    18:18-18:32 UT span already hand-transcribed into the mock
    (design/layout-v3-fullscreen.html's PATH_CENTER, itself sourced from
    NASA GSFC/ytliu independently), so path.ts can be cross-checked
    against a third, independent source on top of eclipse-calc."""
    cases = []
    for minute in range(18, 33):  # 18:18 .. 18:32 UT
        t = ts.utc(2026, 8, 12, 18, minute, 0)
        t_hours = (t.tt - t0.tt) * 24
        row = eclipse.central_line(t).iloc[0]
        cases.append({
            "utc": t.utc_iso(),
            "t_hours_from_t0": t_hours,
            "lat": float(row.lat),
            "lon": float(row.lon),
            "x": float(row.x),
            "y": float(row.y),
            "d": float(row.d),
            "mu0": float(row.mu0),
            "L1": float(row.L1),
            "L2": float(row.L2),
            **{col: float(row[col]) for col in AUX1_COLS},
        })
    return {
        "generated_by": "eclipse-calc 0.1.0 (BesselianEclipse.central_line)",
        "cases": cases,
    }


def shadow_limits_fixture(eclipse, ts, t0):
    """N/S umbral limit points (path edges) at 1-min steps across the
    Spain-crossing window -- same window as golden-central-line.json, so
    it cross-checks against the mock's PATH_NORTH/PATH_SOUTH too. Umbral
    only (umbra=True); penumbral limits aren't needed for this event and
    aren't validated upstream (PLAN.md Sec4)."""
    cases = []
    for minute in range(18, 33):  # 18:18 .. 18:32 UT
        t = ts.utc(2026, 8, 12, 18, minute, 0)
        t_hours = (t.tt - t0.tt) * 24
        B = eclipse.elements_at(t, derivatives=True)
        limits = shadow_limits(B, umbra=True).iloc[0]
        has_n = "N_lat" in limits.index and np.isfinite(limits.get("N_lat", np.nan))
        has_s = "S_lat" in limits.index and np.isfinite(limits.get("S_lat", np.nan))
        cases.append({
            "utc": t.utc_iso(),
            "t_hours_from_t0": t_hours,
            "north": {"lat": float(limits.N_lat), "lon": float(limits.N_lon)} if has_n else None,
            "south": {"lat": float(limits.S_lat), "lon": float(limits.S_lon)} if has_s else None,
        })
    return {
        "generated_by": "eclipse-calc 0.1.0 (eclipse_calc.shadow.shadow_limits, umbra=True)",
        "cases": cases,
    }


def shadow_outline_fixture(eclipse, ts, t0):
    """Umbral shadow footprint polygon at a few instants -- a full 60-point
    sweep at 18:26 UT (well inside the event, matching every other spot-
    check in this file) plus coarser 8-point sweeps at 18:20/18:30 for
    time coverage."""
    cases = []
    for minute, points in ((20, 8), (26, 60), (30, 8)):
        t = ts.utc(2026, 8, 12, 18, minute, 0)
        t_hours = (t.tt - t0.tt) * 24
        B = eclipse.elements_at(t, derivatives=False)
        outline = shadow_outlines(B, points=points, umbra=True)
        rows = []
        for (_time, q), row in outline.iterrows():
            rows.append({
                "q_deg": float(row.Q_deg),
                "lat": float(row.Q_lat) if np.isfinite(row.Q_lat) else None,
                "lon": float(row.Q_lon) if np.isfinite(row.Q_lon) else None,
            })
        cases.append({"utc": t.utc_iso(), "t_hours_from_t0": t_hours, "points": points, "rows": rows})
    return {
        "generated_by": "eclipse-calc 0.1.0 (eclipse_calc.shadow.shadow_outlines, umbra=True)",
        "cases": cases,
    }


def main():
    eph_path = Path(os.environ.get("ECLIPSE_CALC_EPHEMERIS", DEFAULT_EPHEMERIS))
    eph = load_ephemeris(eph_path)
    ts = load.timescale()
    t0 = ts.tt(2026, 8, 12, 18, 0, 0)
    eclipse = BesselianEclipse(t0, eph)

    sites_out = {}
    for name, lat, lon, elev in SITES:
        loc = Location(lat_deg=lat, lon_deg=lon, elevation_m=elev)
        t_max = eclipse.maximum_time(loc)
        ct = eclipse.contact_times(loc)
        sites_out[name] = {
            "lat": lat, "lon": lon, "elevation_m": elev,
            "t_max_hours_from_t0": (t_max.tt - t0.tt) * 24,
            **contact_dict(ct, t0),
        }
        print(f"{name}: {'total ' + str(round(sites_out[name]['duration_s'], 1)) + 's' if ct.is_total_or_annular else 'partial only'}")

    FIXTURES.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "generated_by": "eclipse-calc 0.1.0",
        "t0_tt": "2026-08-12T18:00:00 TD",
        "delta_t_note": (
            "eclipse-calc uses Skyfield's own DeltaT (~68.8-69.2s); the app "
            "locks DeltaT to 69.1s (PLAN.md Sec15) -- expect sub-second "
            "drift vs this file for that reason alone, within Sec12's tolerance."
        ),
        "sites": sites_out,
    }, indent=2))
    print(f"Wrote {OUTPUT}")

    ELEMENTS_OUTPUT.write_text(json.dumps(elements_fixture(eclipse, ts, t0), indent=2))
    print(f"Wrote {ELEMENTS_OUTPUT}")

    OBSERVER_OUTPUT.write_text(json.dumps(observer_fixture(), indent=2))
    print(f"Wrote {OBSERVER_OUTPUT}")

    LOCAL_ELEMENTS_OUTPUT.write_text(json.dumps(local_elements_fixture(eclipse, ts, t0), indent=2))
    print(f"Wrote {LOCAL_ELEMENTS_OUTPUT}")

    CENTRAL_LINE_OUTPUT.write_text(json.dumps(central_line_fixture(eclipse, ts, t0), indent=2))
    print(f"Wrote {CENTRAL_LINE_OUTPUT}")

    SHADOW_LIMITS_OUTPUT.write_text(json.dumps(shadow_limits_fixture(eclipse, ts, t0), indent=2))
    print(f"Wrote {SHADOW_LIMITS_OUTPUT}")

    SHADOW_OUTLINE_OUTPUT.write_text(json.dumps(shadow_outline_fixture(eclipse, ts, t0), indent=2))
    print(f"Wrote {SHADOW_OUTLINE_OUTPUT}")


if __name__ == "__main__":
    main()
