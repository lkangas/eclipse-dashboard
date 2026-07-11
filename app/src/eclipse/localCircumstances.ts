// Local circumstances for one observer (PLAN.md Sec4): combines
// elements.ts + observer.ts into the observer-plane ksi/eta/zeta/L1/L2
// used for contact-time search, then solves for C1-C4.
//
// Ported from eclipse_calc.observer.local_elements (the ksi/eta/zeta/L1/L2
// steps) and eclipse_calc.contacts (the search). eclipse-calc's search
// itself is a Skyfield bisection on a boolean "is eclipsed" predicate; this
// port instead root-finds the smooth signed function
// g(t) = distance(t) - radius(t), which is zero exactly at each contact --
// closer to the classical Meeus method, and what PLAN.md originally
// assumed. See the project conversation for why bisection was used
// upstream (a boolean step function has no usable derivative) and why a
// signed-distance formulation sidesteps that.

import { evaluateElements, type BesselianCoefficients } from './elements';
import { observerPosition } from './observer';

export interface LocalElements {
  x: number;
  y: number;
  ksi: number;
  eta: number;
  zeta: number;
  L1: number;
  L2: number;
}

/** Observer-plane local elements at `tHoursFromT0`, for one fixed
 * observer. `rhoSinPhiPrime`/`rhoCosPhiPrime` come from observer.ts;
 * passed in rather than recomputed here since they don't depend on time
 * and callers searching over many t would otherwise redo that work
 * every evaluation. */
export function localElementsAt(
  coefficients: BesselianCoefficients,
  lonDeg: number,
  rhoSinPhiPrime: number,
  rhoCosPhiPrime: number,
  tHoursFromT0: number,
): LocalElements {
  const el = evaluateElements(coefficients, tHoursFromT0);
  const dRad = (el.d * Math.PI) / 180;
  const thetaRad = ((el.mu0 + lonDeg) * Math.PI) / 180;

  const ksi = rhoCosPhiPrime * Math.sin(thetaRad);
  const eta =
    rhoSinPhiPrime * Math.cos(dRad) - rhoCosPhiPrime * Math.sin(dRad) * Math.cos(thetaRad);
  const zeta =
    rhoSinPhiPrime * Math.sin(dRad) + rhoCosPhiPrime * Math.cos(dRad) * Math.cos(thetaRad);

  return {
    x: el.x,
    y: el.y,
    ksi,
    eta,
    zeta,
    L1: el.l1 - zeta * el.tanf1,
    L2: el.l2 - zeta * el.tanf2,
  };
}

/** Convenience wrapper: geocentric position from lat/elevation, then the
 * local elements at `tHoursFromT0`. Prefer `localElementsAt` directly
 * (with `observerPosition` computed once) when evaluating many times for
 * the same observer, e.g. inside a root-finder. */
export function localElementsForObserver(
  coefficients: BesselianCoefficients,
  latDeg: number,
  lonDeg: number,
  elevationM: number,
  tHoursFromT0: number,
): LocalElements {
  const { rhoSinPhiPrime, rhoCosPhiPrime } = observerPosition(latDeg, elevationM);
  return localElementsAt(coefficients, lonDeg, rhoSinPhiPrime, rhoCosPhiPrime, tHoursFromT0);
}

const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;

/** Minimizes a unimodal function over [a, b] (no derivative needed). */
function goldenSectionMin(f: (t: number) => number, a: number, b: number, tol: number): number {
  let c = b - GOLDEN_RATIO * (b - a);
  let d = a + GOLDEN_RATIO * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tol) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN_RATIO * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN_RATIO * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/** Root of `g` within the bracket [lo, hi] (where g(lo) and g(hi) must have
 * opposite signs), via Newton's method (numerical derivative) safeguarded
 * by bisection whenever a Newton step would leave the shrinking bracket --
 * standard practice for exactly the near-tangent cases (e.g. a short
 * totality) where plain Newton can misbehave. Returns null if there's no
 * sign change in the bracket, i.e. no root there. */
function findRoot(
  g: (t: number) => number,
  lo: number,
  hi: number,
  tol = 1e-7,
): number | null {
  let a = lo;
  let b = hi;
  let fa = g(a);
  const fb = g(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (Math.sign(fa) === Math.sign(fb)) return null;

  let t = (a + b) / 2;
  const h = Math.max((hi - lo) * 1e-6, 1e-9);
  for (let iter = 0; iter < 100; iter++) {
    const ft = g(t);
    if (Math.abs(ft) < 1e-13 || b - a < tol) return t;

    if (Math.sign(ft) === Math.sign(fa)) {
      a = t;
      fa = ft;
    } else {
      b = t;
    }

    const derivative = (g(t + h) - g(t - h)) / (2 * h);
    const newtonStep = derivative !== 0 ? t - ft / derivative : NaN;
    t = Number.isFinite(newtonStep) && newtonStep > a && newtonStep < b ? newtonStep : (a + b) / 2;
  }
  return t;
}

/** Signed distance between the observer and the shadow axis, minus the
 * shadow radius (penumbral for kind="partial", umbral for kind="total") --
 * negative while eclipsed, zero exactly at a contact instant, matching
 * eclipse_calc.contacts.eclipsed's dist2 < radius2 test but as a smooth
 * function instead of a boolean. */
function signedDistance(
  coefficients: BesselianCoefficients,
  lonDeg: number,
  rhoSinPhiPrime: number,
  rhoCosPhiPrime: number,
  kind: 'partial' | 'total',
): (tHoursFromT0: number) => number {
  return (t) => {
    const { x, y, ksi, eta, L1, L2 } = localElementsAt(
      coefficients,
      lonDeg,
      rhoSinPhiPrime,
      rhoCosPhiPrime,
      t,
    );
    const radius = Math.abs(kind === 'partial' ? L1 : L2);
    return Math.hypot(x - ksi, y - eta) - radius;
  };
}

/** Time of minimum distance between observer and shadow axis, searched
 * within `windowHours` of `tGuessHours` (default: a full day centered on
 * T0, matching eclipse_calc.contacts.find_maximum_time's window). Coarse-
 * scans first since the distance isn't necessarily unimodal over a wide
 * window (the observer's ksi/eta cycle roughly once per day with Earth's
 * rotation), then refines with golden-section search in the neighborhood
 * of the coarse minimum, where it is. */
export function findMaximumTime(
  coefficients: BesselianCoefficients,
  latDeg: number,
  lonDeg: number,
  elevationM: number,
  tGuessHours = 0,
  windowHours = 12,
): number {
  const { rhoSinPhiPrime, rhoCosPhiPrime } = observerPosition(latDeg, elevationM);
  const dist2 = (t: number): number => {
    const { x, y, ksi, eta } = localElementsAt(coefficients, lonDeg, rhoSinPhiPrime, rhoCosPhiPrime, t);
    return (x - ksi) ** 2 + (y - eta) ** 2;
  };

  const coarseStepHours = 0.5;
  let bestT = tGuessHours - windowHours;
  let bestVal = dist2(bestT);
  for (let t = tGuessHours - windowHours; t <= tGuessHours + windowHours; t += coarseStepHours) {
    const v = dist2(t);
    if (v < bestVal) {
      bestVal = v;
      bestT = t;
    }
  }

  return goldenSectionMin(dist2, bestT - coarseStepHours, bestT + coarseStepHours, 1e-8);
}

export interface ContactTimes {
  c1: number | null;
  c2: number | null;
  c3: number | null;
  c4: number | null;
}

/** The four contact times (hours from T0) around `tMaxHours`, or all-null
 * if this observer sees no eclipse at all. c2/c3 are null when only a
 * partial eclipse occurs here. Searches +-5h of tMaxHours for C1/C4,
 * matching eclipse_calc.contacts.find_contact_times's own radius. */
export function findContactTimes(
  coefficients: BesselianCoefficients,
  latDeg: number,
  lonDeg: number,
  elevationM: number,
  tMaxHours: number,
): ContactTimes {
  const { rhoSinPhiPrime, rhoCosPhiPrime } = observerPosition(latDeg, elevationM);
  const partialG = signedDistance(coefficients, lonDeg, rhoSinPhiPrime, rhoCosPhiPrime, 'partial');
  const totalG = signedDistance(coefficients, lonDeg, rhoSinPhiPrime, rhoCosPhiPrime, 'total');

  const searchRadiusHours = 5;
  if (partialG(tMaxHours) >= 0) {
    return { c1: null, c2: null, c3: null, c4: null };
  }
  const c1 = findRoot(partialG, tMaxHours - searchRadiusHours, tMaxHours);
  const c4 = findRoot(partialG, tMaxHours, tMaxHours + searchRadiusHours);
  if (c1 === null || c4 === null) {
    return { c1: null, c2: null, c3: null, c4: null };
  }

  let c2: number | null = null;
  let c3: number | null = null;
  if (totalG(tMaxHours) < 0) {
    const c2Try = findRoot(totalG, c1, tMaxHours);
    const c3Try = findRoot(totalG, tMaxHours, c4);
    if (c2Try !== null && c3Try !== null) {
      c2 = c2Try;
      c3 = c3Try;
    }
  }

  return { c1, c2, c3, c4 };
}
