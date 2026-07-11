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

// [a0,a1,a2,a3] -> [a1, 2a2, 3a3] -- the exact analytic derivative of the
// degree-3 polynomial, in units per hour (since t is in hours).
function polyderCoeffs(coeffs: Coeffs4): readonly [number, number, number] {
  const [, a1, a2, a3] = coeffs;
  return [a1, 2 * a2, 3 * a3];
}

function polyvalDerivativePerSecond(coeffs: Coeffs4, t: number): number {
  const [b0, b1, b2] = polyderCoeffs(coeffs);
  const perHour = b0 + b1 * t + b2 * t * t;
  return perHour / 3600; // per-hour -> per-second, matching eclipse-calc's elements_at
}

/** Time derivatives (per second) of all eight elements at `tHoursFromT0` --
 * the exact analytic derivative of the same cached polynomial
 * `evaluateElements` reads, not a numerical approximation. Needed by
 * path.ts's N/S limit tangent-condition solve. Ported from the
 * `derivatives=True` half of eclipse-calc's `elements_at` (there,
 * `_deriv_coeffs` is `np.polyder` applied once at construction time; here
 * it's just evaluated directly, since a degree-3 polynomial's derivative
 * has a trivial closed form). */
export function evaluateDerivatives(
  coefficients: BesselianCoefficients,
  tHoursFromT0: number,
): BesselianElements {
  return {
    x: polyvalDerivativePerSecond(coefficients.x, tHoursFromT0),
    y: polyvalDerivativePerSecond(coefficients.y, tHoursFromT0),
    d: polyvalDerivativePerSecond(coefficients.d, tHoursFromT0),
    mu0: polyvalDerivativePerSecond(coefficients.mu0, tHoursFromT0),
    l1: polyvalDerivativePerSecond(coefficients.l1, tHoursFromT0),
    l2: polyvalDerivativePerSecond(coefficients.l2, tHoursFromT0),
    tanf1: polyvalDerivativePerSecond(coefficients.tanf1, tHoursFromT0),
    tanf2: polyvalDerivativePerSecond(coefficients.tanf2, tHoursFromT0),
  };
}
