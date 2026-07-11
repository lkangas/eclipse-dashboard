// Besselian element polynomial evaluation (PLAN.md Sec4). Coefficients
// come from eclipse-calc at build time (src/data/besselian-2026.json,
// not built yet) -- this module is just the generic degree-3 evaluator,
// ported from eclipse-calc's BesselianEclipse.elements_at.

export type Coeffs4 = readonly [number, number, number, number];

export interface BesselianCoefficients {
  x: Coeffs4;
  y: Coeffs4;
  d: Coeffs4;
  mu0: Coeffs4;
  l1: Coeffs4;
  l2: Coeffs4;
  tanf1: Coeffs4;
  tanf2: Coeffs4;
}

export interface BesselianElements {
  x: number;
  y: number;
  d: number;
  mu0: number;
  l1: number;
  l2: number;
  tanf1: number;
  tanf2: number;
}

// Ascending power order [a0, a1, a2, a3] -- matches eclipse-calc's own
// coefficient storage (see tools/gen-vectors/generate.py), not the
// descending order numpy.polyval expects.
function polyval(coeffs: Coeffs4, t: number): number {
  const [a0, a1, a2, a3] = coeffs;
  return a0 + a1 * t + a2 * t * t + a3 * t * t * t;
}

/** Evaluate all eight Besselian elements at `tHoursFromT0` hours from the
 * polynomial's epoch (T0 = 2026-08-12 18:00 TD). */
export function evaluateElements(
  coefficients: BesselianCoefficients,
  tHoursFromT0: number,
): BesselianElements {
  return {
    x: polyval(coefficients.x, tHoursFromT0),
    y: polyval(coefficients.y, tHoursFromT0),
    d: polyval(coefficients.d, tHoursFromT0),
    mu0: polyval(coefficients.mu0, tHoursFromT0),
    l1: polyval(coefficients.l1, tHoursFromT0),
    l2: polyval(coefficients.l2, tHoursFromT0),
    tanf1: polyval(coefficients.tanf1, tHoursFromT0),
    tanf2: polyval(coefficients.tanf2, tHoursFromT0),
  };
}
