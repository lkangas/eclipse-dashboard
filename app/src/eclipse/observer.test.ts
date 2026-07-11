import { describe, expect, it } from 'vitest';
import { observerPosition } from './observer';
import golden from '../../test/fixtures/golden-observer.json';

describe('observerPosition vs. eclipse-calc golden sites', () => {
  for (const [name, site] of Object.entries(golden.sites)) {
    it(`matches at ${name}`, () => {
      const result = observerPosition(site.lat, site.elevation_m);
      // geocentricLatRad is the identical closed-form formula eclipse-calc
      // uses, so it should match near-exactly; rho goes through a
      // different WGS84 code path (closed-form here vs. Skyfield there)
      // for the same physical quantity, so a slightly looser tolerance.
      expect(result.geocentricLatRad).toBeCloseTo(site.geocentric_lat_rad, 10);
      expect(result.rho).toBeCloseTo(site.rho, 8);
      expect(result.rhoSinPhiPrime).toBeCloseTo(site.rho_sin_phi_prime, 8);
      expect(result.rhoCosPhiPrime).toBeCloseTo(site.rho_cos_phi_prime, 8);
    });
  }
});
