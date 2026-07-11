// Central line, and (soon) N/S totality limits and shadow outline
// (PLAN.md Sec4). Ported from eclipse_calc.central_line / .shadow.

import { evaluateElements, type BesselianCoefficients } from './elements';
import { aux1Elements, ksiEtaToLatLon, type LatLon } from './ellipsoid';

export interface CentralLinePoint extends LatLon {
  L1: number;
  L2: number;
}

/** Central-line lat/lon and on-axis shadow radii L1/L2 at `tHoursFromT0`.
 * The central line is simply the ksi=x, eta=y point of the fundamental
 * plane -- the shadow axis itself. Returns null when the shadow axis
 * misses the Earth's disk at this instant (ellipsoid.ksiEtaToLatLon's
 * null case -- e.g. outside the event's active window). Ported from
 * eclipse_calc.central_line.central_elements. */
export function centralLineAt(
  coefficients: BesselianCoefficients,
  tHoursFromT0: number,
): CentralLinePoint | null {
  const el = evaluateElements(coefficients, tHoursFromT0);
  const aux = aux1Elements(el.d);
  const latlon = ksiEtaToLatLon(aux, el.d, el.mu0, el.x, el.y);
  if (latlon === null) return null;
  return {
    ...latlon,
    L1: el.l1 - latlon.zeta * el.tanf1,
    L2: el.l2 - latlon.zeta * el.tanf2,
  };
}
