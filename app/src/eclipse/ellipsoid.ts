// Earth-ellipsoid auxiliary quantities, shared by the central-line,
// shadow-outline, and shadow-limit calculations (path.ts). Ported from
// eclipse_calc.ellipsoid.

import { E2, F } from './constants';

export interface Aux1Elements {
  rho1: number;
  rho2: number;
  sind1: number;
  cosd1: number;
  sind1d2: number;
  cosd1d2: number;
}

/** Earth-flattening-dependent quantities that depend only on the shadow
 * axis's declination `dDeg`. Ported from eclipse_calc.ellipsoid.aux1_elements. */
export function aux1Elements(dDeg: number): Aux1Elements {
  const dRad = (dDeg * Math.PI) / 180;
  const sind = Math.sin(dRad);
  const cosd = Math.cos(dRad);

  const rho1 = Math.sqrt(1 - E2 * cosd ** 2);
  const rho2 = Math.sqrt(1 - E2 * sind ** 2);

  const sind1 = sind / rho1;
  const cosd1 = (Math.sqrt(1 - E2) * cosd) / rho1;
  const sind1d2 = (E2 * sind * cosd) / rho1 / rho2;
  const cosd1d2 = Math.sqrt(1 - E2) / rho1 / rho2;

  return { rho1, rho2, sind1, cosd1, sind1d2, cosd1d2 };
}

export interface LatLon {
  lat: number; // degrees
  lon: number; // degrees
  zeta: number;
}

/** Wraps `deg` into [-180, 180). JS's `%` keeps the dividend's sign
 * (unlike Python's, which always matches the divisor's), hence the extra
 * `+360, %360` rather than a direct port of the Python one-liner. */
function wrapLongitude(deg: number): number {
  const shifted = deg + 180;
  const wrapped = ((shifted % 360) + 360) % 360;
  return wrapped - 180;
}

/** Converts a fundamental-plane ksi/eta position to lat/lon (+ zeta), by
 * intersecting the shadow axis at that offset with the WGS84 ellipsoid.
 * Returns null when `ksi`/`eta` don't lie on the ellipsoid (the
 * geometric equivalent of eclipse_calc's NaN result there -- e.g.
 * expected while a root-finder's bracket search scans outside the
 * shadow). Ported from eclipse_calc.ellipsoid.ksieta_to_latlon
 * (`terminator=False` path only; the terminator=True path, used only by
 * terminator.py, isn't needed yet). */
export function ksiEtaToLatLon(
  aux: Aux1Elements,
  dDeg: number,
  mu0Deg: number,
  ksi: number,
  eta: number,
): LatLon | null {
  const { rho1, rho2, sind1, cosd1, sind1d2, cosd1d2 } = aux;

  const eta1 = eta / rho1;
  const radical = 1 - ksi ** 2 - eta1 ** 2;
  if (radical < 0) return null;
  const zeta1 = Math.sqrt(radical);
  const zeta = rho2 * (zeta1 * cosd1d2 - eta1 * sind1d2);

  const phi1 = Math.asin(eta1 * cosd1 + zeta1 * sind1);
  const cosPhi1 = Math.cos(phi1);
  const sinTheta = ksi / cosPhi1;
  const cosTheta = (-eta1 * sind1 + zeta1 * cosd1) / cosPhi1;
  const theta = Math.atan2(sinTheta, cosTheta);

  const phi = Math.atan(Math.tan(phi1) / (1 - F));

  const thetaDeg = (theta * 180) / Math.PI;
  const latDeg = (phi * 180) / Math.PI;
  const lonDeg = wrapLongitude(thetaDeg - mu0Deg);

  return { lat: latDeg, lon: lonDeg, zeta };
}
