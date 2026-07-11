// Physical constants shared across the eclipse-core modules, matching
// eclipse_calc.constants (IAU/Explanatory Supplement conventions).

export const RE = 6.3781370e6; // Earth equatorial radius, meters
export const F = 1 / 298.25642; // WGS84-style flattening
export const E2 = 2 * F - F * F; // eccentricity squared
export const E = Math.sqrt(E2);
