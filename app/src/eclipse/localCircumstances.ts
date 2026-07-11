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
