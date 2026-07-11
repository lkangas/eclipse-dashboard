import { describe, expect, it } from 'vitest';
import { localElementsForObserver } from './localCircumstances';
import type { BesselianCoefficients } from './elements';
import elementsGolden from '../../test/fixtures/golden-elements.json';
import localGolden from '../../test/fixtures/golden-local-elements.json';

const coefficients = elementsGolden.coefficients as unknown as BesselianCoefficients;

describe('localElementsForObserver vs. eclipse-calc golden cases', () => {
  for (const c of localGolden.cases) {
    it(`matches ${c.site} at t=${c.t_hours_from_t0}h`, () => {
      const result = localElementsForObserver(coefficients, c.lat, c.lon, c.elevation_m, c.t_hours_from_t0);
      expect(result.x).toBeCloseTo(c.x, 9);
      expect(result.y).toBeCloseTo(c.y, 9);
      expect(result.ksi).toBeCloseTo(c.ksi, 7);
      expect(result.eta).toBeCloseTo(c.eta, 7);
      expect(result.zeta).toBeCloseTo(c.zeta, 7);
      expect(result.L1).toBeCloseTo(c.L1, 7);
      expect(result.L2).toBeCloseTo(c.L2, 7);
    });
  }
});
