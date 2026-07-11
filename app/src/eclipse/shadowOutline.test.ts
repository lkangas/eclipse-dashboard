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
    // 60 regular samples, minus the off-disk run, plus 2 bisected
    // crossing points, plus up to TERMINATOR_ARC_SEGMENTS-1 great-circle
    // bridge points between them (see the next test) -- comfortably
    // under 60 + 2 + 15.
    expect(outline.length).toBeLessThan(80);
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
    // wrongly read as ~6 away from 0 instead of ~0). Great-circle bridge
    // points (next test) carry `qDeg: NaN`, which this check's `> 1e-6`
    // comparison never satisfies (NaN comparisons are always false), so
    // they don't need excluding explicitly here.
    const outline = shadowOutlineAt(coefficients, T_PARTIAL, 60);
    const nonGridPoints = outline.filter((p) => {
      const nearestGrid = Math.round(p.qDeg / 6) * 6;
      return Math.abs(p.qDeg - nearestGrid) > 1e-6;
    });
    expect(nonGridPoints).toHaveLength(2);
  });

  it('bridges the gap between the two crossings with points along their great circle', () => {
    const outline = shadowOutlineAt(coefficients, T_PARTIAL, 60);
    const bridgeIdx = outline.map((p, i) => (Number.isNaN(p.qDeg) ? i : -1)).filter((i) => i >= 0);
    // TERMINATOR_ARC_SEGMENTS - 1 interior points, contiguous in the
    // array (sitting strictly between the exit and entry crossings).
    expect(bridgeIdx).toHaveLength(15);
    expect(bridgeIdx[bridgeIdx.length - 1] - bridgeIdx[0]).toBe(bridgeIdx.length - 1);

    const exit = outline[bridgeIdx[0] - 1];
    const entry = outline[bridgeIdx[bridgeIdx.length - 1] + 1];
    const toRad = Math.PI / 180;
    function greatCircleDist(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
      const phi1 = a.lat * toRad,
        phi2 = b.lat * toRad;
      const dphi = (b.lat - a.lat) * toRad,
        dlam = (b.lon - a.lon) * toRad;
      const h = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
      return 2 * Math.asin(Math.sqrt(h));
    }
    const total = greatCircleDist(exit, entry);
    // Every bridge point should lie ON the great circle joining exit and
    // entry (its distances to both endpoints sum to exactly the
    // endpoint-to-endpoint distance -- off-circle points would sum to
    // more, by the triangle inequality) and should be encountered in
    // monotonically increasing order along that arc.
    let prevFrac = 0;
    for (const i of bridgeIdx) {
      const p = outline[i];
      const dExit = greatCircleDist(exit, p);
      const dEntry = greatCircleDist(p, entry);
      expect(dExit + dEntry).toBeCloseTo(total, 6);
      const frac = dExit / total;
      expect(frac).toBeGreaterThan(prevFrac);
      prevFrac = frac;
    }
  });

  it('fully outside the disk (deep in the night side) yields an empty polygon', () => {
    const T_FAR = 0.8525511100888252; // 2026-08-12T18:50:00Z, TT-hours-from-T0
    const outline = shadowOutlineAt(coefficients, T_FAR, 60);
    expect(outline).toHaveLength(0);
  });

  it('never produces a NaN point across a dense sweep through the whole transition', () => {
    // Regression test for a real bug: pointAt's fixed-point iteration
    // had no guard against its own zeta1 going NaN mid-loop (possible
    // even when marginAt's cheaper un-iterated check said "inside",
    // since the iterated/zeta-corrected shadow radius can differ enough
    // right at the edge to push a q that marginAt approved past the
    // ellipsoid) -- the NaN then propagated silently through the rest
    // of the loop (the break condition never fires on NaN) into
    // ksiEtaToLatLon, whose own `radical < 0` check also didn't catch a
    // NaN radical (NaN comparisons are always false), producing a
    // non-null {lat: NaN, lon: NaN} point pushed straight into the
    // polygon. Visible in the app as an intermittent flicker: which of
    // the 60 sample angles triggers it shifts frame to frame as the
    // geometry moves, so a single fixed instant (the tests above) can
    // pass while the live animation still glitches. This sweeps every
    // second across the whole terminator transition (well before onset
    // through well past full disk-exit) specifically to catch that --
    // confirmed this test fails on the pre-fix code.
    for (let sec = 29 * 60; sec <= 36 * 60; sec++) {
      const tHours = sec / 3600;
      const outline = shadowOutlineAt(coefficients, tHours, 60);
      for (const p of outline) {
        expect(Number.isFinite(p.lat), `lat at t=${tHours}h`).toBe(true);
        expect(Number.isFinite(p.lon), `lon at t=${tHours}h`).toBe(true);
      }
    }
  });
});
