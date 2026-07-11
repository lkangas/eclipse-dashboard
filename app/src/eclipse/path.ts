// Central line, N/S umbral limits, and the shadow outline (PLAN.md Sec4).
// Ported from eclipse_calc.central_line / .shadow.

import { evaluateDerivatives, evaluateElements, type BesselianCoefficients } from './elements';
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

export interface ShadowLimits {
  north: LatLon | null;
  south: LatLon | null;
}

/** North/south **umbral** limit points at `tHoursFromT0` -- the two points
 * where the umbral shadow cone is tangent to the WGS84 ellipsoid (the
 * edges of the totality path). Iterates a linearized tangent condition
 * (Explanatory Supplement Sec 11.77) to a fixed point in ksi/eta space.
 * Either side is null if its iteration doesn't converge. Ported from
 * eclipse_calc.shadow.shadow_limits, umbra=True only -- penumbral limits
 * aren't needed for this event and aren't validated upstream either
 * (PLAN.md Sec4). */
export function shadowLimitsAt(
  coefficients: BesselianCoefficients,
  tHoursFromT0: number,
  maxIter = 10,
  zetaTol = 1e-8,
): ShadowLimits {
  const el = evaluateElements(coefficients, tHoursFromT0);
  const deriv = evaluateDerivatives(coefficients, tHoursFromT0);
  const aux = aux1Elements(el.d);

  const dRad = (el.d * Math.PI) / 180;
  const dMu0DtRad = (deriv.mu0 * Math.PI) / 180;
  const dDDtRad = (deriv.d * Math.PI) / 180;
  const sec2f = 1 + el.tanf2 ** 2;

  // Linearized tangent-condition coefficients (constant across both
  // offsets/iterations for a given time).
  const a = -deriv.l2 - dMu0DtRad * el.x * Math.cos(dRad) * el.tanf2 + el.y * dDDtRad * el.tanf2;
  const b = -deriv.y + dMu0DtRad * el.x * Math.sin(dRad) + el.l2 * dDDtRad * el.tanf2;
  const c =
    deriv.x + dMu0DtRad * el.y * Math.sin(dRad) + el.l2 * dMu0DtRad * el.tanf2 * Math.cos(dRad);
  const q1 = Math.atan(b / c);

  let north: LatLon | null = null;
  let south: LatLon | null = null;

  for (const offset of [0, Math.PI]) {
    let q = q1 + offset;
    let L = el.l2; // initial guess, zeta = 0

    let ksi = el.x - L * Math.sin(q);
    let eta = el.y - L * Math.cos(q);
    let eta1 = eta / aux.rho1;
    let zeta1 = Math.sqrt(1 - ksi ** 2 - eta1 ** 2); // NaN off-ellipse, matching eclipse-calc
    let zeta = aux.rho2 * (zeta1 * aux.cosd1d2 - eta1 * aux.sind1d2);

    let converged = false;
    for (let i = 0; i < maxIter; i++) {
      const tanQ =
        (b - dDDtRad * zeta * sec2f - a / Math.cos(q)) /
        (c - dMu0DtRad * zeta * sec2f * Math.cos(dRad));
      q = Math.atan(tanQ) + offset;
      L = el.l2 - zeta * el.tanf2;

      ksi = el.x - L * Math.sin(q);
      eta = el.y - L * Math.cos(q);
      eta1 = eta / aux.rho1;
      zeta1 = Math.sqrt(1 - ksi ** 2 - eta1 ** 2);

      const prevZeta = zeta;
      zeta = aux.rho2 * (zeta1 * aux.cosd1d2 - eta1 * aux.sind1d2);
      if (Math.abs(prevZeta - zeta) < zetaTol) {
        converged = true;
        break;
      }
    }

    if (!converged || !Number.isFinite(zeta1)) continue;

    const latlon = ksiEtaToLatLon(aux, el.d, el.mu0, ksi, eta);
    if (latlon === null) continue;

    if (L * Math.cos(q) > 0) {
      south = latlon;
    } else {
      north = latlon;
    }
  }

  return { north, south };
}

export interface ShadowOutlinePoint extends LatLon {
  qDeg: number;
}

/** The **umbral** shadow footprint polygon at `tHoursFromT0`: `points + 1`
 * evenly-spaced positions around the shadow-cone circle in the
 * fundamental plane (first and last coincide, closing the polygon).
 * Points where the swept position falls outside Earth's disk are
 * omitted from the result -- expected near the edges of the event, not
 * an error. No time derivatives needed here (unlike shadowLimitsAt),
 * just a fixed-point iteration on zeta per position angle. Ported from
 * eclipse_calc.shadow.shadow_outlines, umbra=True only (penumbral is a
 * separate, later need for the Global map tab, PLAN.md Sec8). */
export function shadowOutlineAt(
  coefficients: BesselianCoefficients,
  tHoursFromT0: number,
  points = 60,
): ShadowOutlinePoint[] {
  const el = evaluateElements(coefficients, tHoursFromT0);
  const aux = aux1Elements(el.d);
  const result: ShadowOutlinePoint[] = [];

  for (let i = 0; i <= points; i++) {
    const q = (2 * Math.PI * i) / points;
    const sinQ = Math.sin(q);
    const cosQ = Math.cos(q);

    let ksi = el.x - el.l2 * sinQ;
    let eta = el.y - el.l2 * cosQ;
    let eta1 = eta / aux.rho1;
    let zeta1 = Math.sqrt(1 - ksi ** 2 - eta1 ** 2); // NaN off-ellipse, matching eclipse-calc
    let zeta = aux.rho2 * (zeta1 * aux.cosd1d2 - eta1 * aux.sind1d2);
    let shadowRadius = el.l2 - zeta * el.tanf2;

    for (let iter = 0; iter < 10; iter++) {
      ksi = el.x - shadowRadius * sinQ;
      eta = el.y - shadowRadius * cosQ;
      eta1 = eta / aux.rho1;
      zeta1 = Math.sqrt(1 - ksi ** 2 - eta1 ** 2);

      const prevZeta = zeta;
      zeta = aux.rho2 * (zeta1 * aux.cosd1d2 - eta1 * aux.sind1d2);
      if (Math.abs(prevZeta - zeta) < 1e-8) break;
      shadowRadius = el.l2 - zeta * el.tanf2;
    }

    const latlon = ksiEtaToLatLon(aux, el.d, el.mu0, ksi, eta);
    if (latlon !== null) {
      result.push({ ...latlon, qDeg: (q * 180) / Math.PI });
    }
  }

  return result;
}
