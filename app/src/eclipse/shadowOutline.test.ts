import { describe, expect, it } from 'vitest';
import { shadowOutlineAt } from './shadowOutline';
import type { BesselianCoefficients } from './elements';
import elementsGolden from '../../test/fixtures/golden-elements.json';
import outlineGolden from '../../test/fixtures/golden-shadow-outline.json';

const coefficients = elementsGolden.coefficients as unknown as BesselianCoefficients;

describe('shadowOutlineAt vs. eclipse-calc golden umbral outlines', () => {
  // All golden cases sit well inside the visible disk (18:20-18:30 UT,
  // ahead of the ~18:30:10 UT onset found by probing eclipse-calc
  // directly -- see shadowOutline's own terminator-crossing test below),
  // so every point is expected to converge: no NaNs, no crossing
  // insertions, straight 1:1 comparison against the oracle.
  for (const c of outlineGolden.cases) {
    it(`matches ${c.utc} (${c.points} points)`, () => {
      const outline = shadowOutlineAt(coefficients, c.t_hours_from_t0, c.points);
      expect(outline).toHaveLength(c.rows.length);

      for (let i = 0; i < c.rows.length; i++) {
        const expected = c.rows[i];
        const actual = outline[i];
        expect(actual.qDeg).toBeCloseTo(expected.q_deg, 6);
        if (expected.lat === null) {
          throw new Error('golden fixture has a null point; test needs updating to handle it');
        }
        expect(actual.lat).toBeCloseTo(expected.lat, 6);
        expect(actual.lon).toBeCloseTo(expected.lon!, 6);
      }
    });
  }
});

describe('shadowOutlineAt near the day/night terminator', () => {
  // 2026-08-12T18:32:00Z, probed directly against eclipse-calc's own
  // shadow_outline: a plain (non-bisected) 60-point sweep there has 29 of
  // 61 raw samples off the visible disk -- comfortably "some, but not
  // all", astride the ~18:30:10 UT onset and well short of full disk-exit
  // (~18:34:20 UT, also probed).
  const T_PARTIAL = 0.5525511056184769; // TT-hours-from-T0

  it('produces no NaN/undefined points and closes the ring', () => {
    const outline = shadowOutlineAt(coefficients, T_PARTIAL, 60);
    expect(outline.length).toBeGreaterThan(10);
    expect(outline.length).toBeLessThan(62); // some regular samples were dropped
    for (const p of outline) {
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lon)).toBe(true);
    }
  });

  it('inserts exactly two bisected crossing points bridging the gap', () => {
    // A regular 60-point sweep has samples every 6deg; a genuine
    // terminator-crossing insertion lands strictly between two adjacent
    // 6deg-grid angles rather than exactly on one -- distinguishing it
    // from an ordinary sample (distance-to-nearest-multiple-of-6, not a
    // raw `% 6`, since floating point can put an exact grid point a hair
    // under the next multiple, e.g. 137.99999999999997, which `% 6` would
    // wrongly read as ~6 away from 0 instead of ~0).
    const outline = shadowOutlineAt(coefficients, T_PARTIAL, 60);
    const nonGridPoints = outline.filter((p) => {
      const nearestGrid = Math.round(p.qDeg / 6) * 6;
      return Math.abs(p.qDeg - nearestGrid) > 1e-6;
    });
    expect(nonGridPoints).toHaveLength(2);
  });

  it('fully outside the disk (deep in the night side) yields an empty polygon', () => {
    const T_FAR = 0.8525511100888252; // 2026-08-12T18:50:00Z, TT-hours-from-T0
    const outline = shadowOutlineAt(coefficients, T_FAR, 60);
    expect(outline).toHaveLength(0);
  });
});
