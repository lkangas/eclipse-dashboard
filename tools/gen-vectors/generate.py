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

from skyfield.api import load

from eclipse_calc import BesselianEclipse, Location, load_ephemeris

DEFAULT_EPHEMERIS = Path(r"C:\Users\lauri.kangas\OneDrive\python\eclipse\de440s.bsp")
FIXTURES = Path(__file__).resolve().parent.parent.parent / "app" / "test" / "fixtures"
OUTPUT = FIXTURES / "golden-vectors.json"
ELEMENTS_OUTPUT = FIXTURES / "golden-elements.json"

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


def contact_dict(ct):
    # Truthy-checking a Skyfield Time (`if ct.c1`) falls back to __len__,
    # which raises for a genuinely scalar Time -- must use `is not None`,
    # same as eclipse-calc's own ContactTimes.is_total_or_annular does.
    return {
        "c1": ct.c1.utc_iso() if ct.c1 is not None else None,
        "c2": ct.c2.utc_iso() if ct.c2 is not None else None,
        "c3": ct.c3.utc_iso() if ct.c3 is not None else None,
        "c4": ct.c4.utc_iso() if ct.c4 is not None else None,
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
        row = eclipse.elements_at(t, derivatives=False).iloc[0]
        samples.append({"t_hours_from_t0": hours, **{col: float(row[col]) for col in ELEMENT_COLS}})

    return {
        "generated_by": "eclipse-calc 0.1.0",
        "t0_tt": "2026-08-12T18:00:00 TD",
        "note": "coefficients are ascending power order [a0, a1, a2, a3]; t is hours from t0",
        "coefficients": coeffs,
        "samples": samples,
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
        ct = eclipse.contact_times(loc)
        sites_out[name] = {"lat": lat, "lon": lon, "elevation_m": elev, **contact_dict(ct)}
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


if __name__ == "__main__":
    main()
