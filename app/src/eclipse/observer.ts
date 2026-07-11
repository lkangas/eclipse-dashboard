// Geocentric observer position (PLAN.md Sec4): rho*sin(geocentric_lat) and
// rho*cos(geocentric_lat), needed by localCircumstances.ts's ksi/eta/zeta
// terms. Ported from eclipse_calc.observer.local_elements's rho/
// geocentric_lat steps -- note geocentric_lat there is elevation-
// independent by design (the exact geocentric latitude of the ellipsoid-
// surface point at this geodetic latitude), while rho includes elevation
// via the full WGS84 position magnitude. This module replicates that
// split with a closed-form WGS84 geodetic-to-ECEF formula instead of
// eclipse-calc's Skyfield call, verified to match it to ~1e-8 relative
// precision (longitude cancels out of the magnitude, so it isn't a
// parameter here -- it enters later via the hour-angle term).

const RE = 6.3781370e6; // Earth equatorial radius, meters (eclipse_calc.constants.RE)
const F = 1 / 298.25642; // WGS84-style flattening (eclipse_calc.constants.f)
const E2 = 2 * F - F * F; // eccentricity squared

export interface ObserverPosition {
  rho: number;
  geocentricLatRad: number;
  rhoSinPhiPrime: number;
  rhoCosPhiPrime: number;
}

/** Geocentric position factors for an observer at `latDeg`/`elevationM`. */
export function observerPosition(latDeg: number, elevationM: number): ObserverPosition {
  const latRad = (latDeg * Math.PI) / 180;
  const geocentricLatRad = Math.atan((1 - F) ** 2 * Math.tan(latRad));

  const N = RE / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
  const equatorialComponent = (N + elevationM) * Math.cos(latRad);
  const polarComponent = (N * (1 - E2) + elevationM) * Math.sin(latRad);
  const rho = Math.sqrt(equatorialComponent ** 2 + polarComponent ** 2) / RE;

  return {
    rho,
    geocentricLatRad,
    rhoSinPhiPrime: rho * Math.sin(geocentricLatRad),
    rhoCosPhiPrime: rho * Math.cos(geocentricLatRad),
  };
}
