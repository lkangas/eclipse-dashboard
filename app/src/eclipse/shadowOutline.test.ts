import { describe, expect, it } from 'vitest';
import { shadowOutlineAt } from './path';
import type { BesselianCoefficients } from './elements';
import elementsGolden from '../../test/fixtures/golden-elements.json';
import outlineGolden from '../../test/fixtures/golden-shadow-outline.json';

const coefficients = elementsGolden.coefficients as unknown as BesselianCoefficients;

describe('shadowOutlineAt vs. eclipse-calc golden umbral outlines', () => {
  for (const c of outlineGolden.cases) {
    it(`matches ${c.utc} (${c.points} points)`, () => {
      const outline = shadowOutlineAt(coefficients, c.t_hours_from_t0, c.points);
      expect(outline).toHaveLength(c.rows.length);

      for (let i = 0; i < c.rows.length; i++) {
        const expected = c.rows[i];
        const actual = outline[i];
        expect(actual.qDeg).toBeCloseTo(expected.q_deg, 6);
        if (expected.lat === null) {
          // Not exercised by the current fixture (all sampled instants are
          // well inside the event), but kept so a future off-Earth case
          // fails loudly instead of silently mismatching array lengths.
          throw new Error('golden fixture has a null point; test needs updating to handle it');
        }
        expect(actual.lat).toBeCloseTo(expected.lat, 6);
        expect(actual.lon).toBeCloseTo(expected.lon!, 6);
      }
    });
  }
});
