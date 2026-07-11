import { describe, expect, it } from 'vitest';
import { centralLineAt } from './path';
import type { BesselianCoefficients } from './elements';
import elementsGolden from '../../test/fixtures/golden-elements.json';
import centralLineGolden from '../../test/fixtures/golden-central-line.json';

const coefficients = elementsGolden.coefficients as unknown as BesselianCoefficients;

describe('centralLineAt vs. eclipse-calc golden central line', () => {
  for (const c of centralLineGolden.cases) {
    it(`matches ${c.utc}`, () => {
      const point = centralLineAt(coefficients, c.t_hours_from_t0);
      expect(point).not.toBeNull();
      expect(point!.lat).toBeCloseTo(c.lat, 6);
      expect(point!.lon).toBeCloseTo(c.lon, 6);
      expect(point!.L1).toBeCloseTo(c.L1, 6);
      expect(point!.L2).toBeCloseTo(c.L2, 6);
    });
  }
});
