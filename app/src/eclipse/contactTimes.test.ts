import { describe, expect, it } from 'vitest';
import { findContactTimes, findMaximumTime } from './localCircumstances';
import type { BesselianCoefficients } from './elements';
import elementsGolden from '../../test/fixtures/golden-elements.json';
import vectorsGolden from '../../test/fixtures/golden-vectors.json';

const coefficients = elementsGolden.coefficients as unknown as BesselianCoefficients;

// Sub-second tolerance (PLAN.md Sec12): 1s = 1/3600h; require well inside that.
const SUBSECOND_TOL_HOURS = 0.05 / 3600;

describe('findMaximumTime / findContactTimes vs. eclipse-calc golden sites', () => {
  for (const [name, site] of Object.entries(vectorsGolden.sites)) {
    it(`matches ${name}`, () => {
      const tMax = findMaximumTime(coefficients, site.lat, site.lon, site.elevation_m);
      expect(tMax).toBeCloseTo(site.t_max_hours_from_t0, 3);

      const contacts = findContactTimes(coefficients, site.lat, site.lon, site.elevation_m, tMax);

      if (site.c1_hours_from_t0 === null) {
        expect(contacts.c1).toBeNull();
        return;
      }
      expect(contacts.c1).not.toBeNull();
      expect(Math.abs(contacts.c1! - site.c1_hours_from_t0)).toBeLessThan(SUBSECOND_TOL_HOURS);
      expect(Math.abs(contacts.c4! - site.c4_hours_from_t0)).toBeLessThan(SUBSECOND_TOL_HOURS);

      if (site.is_total && site.c2_hours_from_t0 !== null && site.c3_hours_from_t0 !== null) {
        expect(contacts.c2).not.toBeNull();
        expect(contacts.c3).not.toBeNull();
        expect(Math.abs(contacts.c2! - site.c2_hours_from_t0)).toBeLessThan(SUBSECOND_TOL_HOURS);
        expect(Math.abs(contacts.c3! - site.c3_hours_from_t0)).toBeLessThan(SUBSECOND_TOL_HOURS);

        const durationS = (contacts.c3! - contacts.c2!) * 3600;
        expect(durationS).toBeCloseTo(site.duration_s ?? NaN, 0);
      } else {
        expect(contacts.c2).toBeNull();
        expect(contacts.c3).toBeNull();
      }
    });
  }
});
