"""Generate src/data/besselian-2026.json -- the real Besselian element
coefficients the shipped app loads at runtime (PLAN.md Sec3 item 3).

Not to be confused with tools/gen-vectors, which generates *test*
fixtures; this generates the actual app data. Run manually:

    python tools/build-data/generate_besselian.py

Needs eclipse-calc installed (pip install -e ../eclipse-calc, PLAN.md
Sec11) and a DE440s ephemeris kernel -- point ECLIPSE_CALC_EPHEMERIS at
one, or it falls back to the known-local copy in the research sandbox.
Commit the output JSON when eclipse-calc's math changes; the app reads
it directly, this only runs at build time (PLAN.md Sec2/Sec3).
"""

import json
import os
from pathlib import Path

from skyfield.api import load

from eclipse_calc import BesselianEclipse, load_ephemeris

DEFAULT_EPHEMERIS = Path(r"C:\Users\lauri.kangas\OneDrive\python\eclipse\de440s.bsp")
OUTPUT = Path(__file__).resolve().parent.parent.parent / "app" / "src" / "data" / "besselian-2026.json"

# Matches src/eclipse/elements.ts's BesselianCoefficients field order exactly,
# so this file can be used as that interface's shape directly, no adaptation.
ELEMENT_COLS = ["x", "y", "d", "mu0", "l1", "l2", "tanf1", "tanf2"]

# Locked app-wide (PLAN.md Sec14 #5/Sec15), NOT eclipse-calc's own Skyfield
# DeltaT (~68.8-69.2s depending on data source) -- the two agree closely, but
# the app needs one fixed value for TD<->UT conversion, chosen by the user.
DELTA_T_SECONDS = 69.1


def main():
    eph_path = Path(os.environ.get("ECLIPSE_CALC_EPHEMERIS", DEFAULT_EPHEMERIS))
    eph = load_ephemeris(eph_path)
    ts = load.timescale()
    t0 = ts.tt(2026, 8, 12, 18, 0, 0)
    eclipse = BesselianEclipse(t0, eph)

    coefficients = {col: eclipse._coeffs[col].tolist() for col in ELEMENT_COLS}

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "event": "2026-08-12 total solar eclipse, Spain",
        "t0_tt": "2026-08-12T18:00:00",
        "t0_tt_note": "T0 for the coefficients below, Terrestrial Time -- t in evaluateElements(coefficients, t) is hours from this instant",
        "delta_t_seconds": DELTA_T_SECONDS,
        "generated_by": "eclipse-calc 0.1.0 (BesselianEclipse), tools/build-data/generate_besselian.py",
        "coefficients": coefficients,
    }, indent=2))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
