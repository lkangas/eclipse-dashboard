import { describe, expect, it } from 'vitest';
import { shadowLimitsAt } from './path';
import type { BesselianCoefficients } from './elements';
import elementsGolden from '../../test/fixtures/golden-elements.json';
import limitsGolden from '../../test/fixtures/golden-shadow-limits.json';

const coefficients = elementsGolden.coefficients as unknown as BesselianCoefficients;

// eclipse_calc.shadow.shadow_limits has a real bug (confirmed by tracing
// its actual source, not just this port's output): its `L` variable is
// declared once *outside* the `for offset in (0, pi)` loop instead of
// reset per offset, so when the first offset (north, expected to fail
// past 18:30 -- the sunset cusp) leaves L as NaN, that NaN leaks into the
// second offset's (south) starting point and fails it too, even though
// south's tangent point converges cleanly on its own. This port resets
// L per offset (as the algorithm requires) and does NOT reproduce that
// bug, so it correctly still finds the south limit at 18:31/18:32 UT --
// confirmed against ytliu.epizy.com's independently-published south
// limit for those two minutes (41.5517,-5.8850 / 40.7233,-4.1417, see
// design/layout-v3-fullscreen.html's PATH_SOUTH), which this port's
// output (below) matches to ~0.003 deg, the same tier of agreement as
// every other cross-checked point in this file.
const KNOWN_ORACLE_BUG_SOUTH: Record<string, { lat: number; lon: number }> = {
  '2026-08-12T18:31:00Z': { lat: 41.5517, lon: -5.885 },
  '2026-08-12T18:32:00Z': { lat: 40.7233, lon: -4.1417 },
};

describe('shadowLimitsAt vs. eclipse-calc golden N/S umbral limits', () => {
  for (const c of limitsGolden.cases) {
    it(`matches ${c.utc}`, () => {
      const { north, south } = shadowLimitsAt(coefficients, c.t_hours_from_t0);

      if (c.north === null) {
        expect(north).toBeNull();
      } else {
        expect(north).not.toBeNull();
        expect(north!.lat).toBeCloseTo(c.north.lat, 6);
        expect(north!.lon).toBeCloseTo(c.north.lon, 6);
      }

      const knownBug = KNOWN_ORACLE_BUG_SOUTH[c.utc];
      if (knownBug) {
        expect(south).not.toBeNull();
        expect(south!.lat).toBeCloseTo(knownBug.lat, 2);
        expect(south!.lon).toBeCloseTo(knownBug.lon, 2);
      } else if (c.south === null) {
        expect(south).toBeNull();
      } else {
        expect(south).not.toBeNull();
        expect(south!.lat).toBeCloseTo(c.south.lat, 6);
        expect(south!.lon).toBeCloseTo(c.south.lon, 6);
      }
    });
  }
});
