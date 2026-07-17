import { describe, expect, it } from 'vitest';
import {
  apparentElevationDeg,
  checkHorizonObstruction,
  EYE_HEIGHT_M,
  terrainHorizonProfile,
  type ContactSunPosition,
  type HorizonPoint,
} from './horizon';

describe('apparentElevationDeg vs. the standard horizon-dip formula', () => {
  // Independent reference, not derived from this module's own constants:
  // the classic navigation/surveying approximation for how far below the
  // true horizontal the sea-level horizon appears for an observer at
  // height h, under standard atmospheric refraction -- dip(arcmin) ~=
  // 1.76 * sqrt(h_meters). The horizon itself is where apparentElevationDeg
  // stops decreasing as distance grows (past that, distance drop and
  // curvature dip trade off) -- happens at d = sqrt(2 * R_eff * h) with
  // R_eff = (7/6) * 6,371,000 m, independently reconstructed here (not
  // imported) so this is a real cross-check, not just self-consistency.
  const EARTH_RADIUS_M = 6_371_000;
  const EFFECTIVE_EARTH_RADIUS_M = (7 / 6) * EARTH_RADIUS_M;

  // A relative (not absolute-decimal) tolerance: the 1.76'*sqrt(h)
  // reference is itself an approximation whose own error grows with h (it's
  // normally quoted for nautical/aviation-scale heights, tens to a few
  // hundred meters) -- 3% comfortably separates "matches the standard
  // reference" from "the implementation used the wrong constant/formula
  // entirely" (which would be off by 10s of percent, not a few).
  it.each([1.7, 10, 100, 1000])('matches the 1.76′·√h reference at h=%dm', (h) => {
    const horizonDistanceM = Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M * h);
    const dipDeg = apparentElevationDeg(h, 0, horizonDistanceM);
    const expectedDipArcmin = 1.76 * Math.sqrt(h);
    const relativeError = Math.abs(dipDeg * 60 - -expectedDipArcmin) / expectedDipArcmin;
    expect(relativeError).toBeLessThan(0.03);
  });

  it('reads a small negative dip (not exactly 0) for a target at the observer\'s own height, close up', () => {
    // Two points at the *same* absolute elevation, some distance apart,
    // are NOT on the same "true horizontal" line once Earth's curvature is
    // considered -- the target sits slightly below the observer's own
    // level tangent plane at that distance, by the curvature/refraction
    // drop term. At 1000m this is tiny (a few thousandths of a degree),
    // but it is not zero, and shouldn't be.
    const curvatureDropM = 1000 ** 2 / (2 * EFFECTIVE_EARTH_RADIUS_M);
    const expectedDeg = (Math.atan2(-curvatureDropM, 1000) * 180) / Math.PI;
    expect(apparentElevationDeg(500, 500, 1000)).toBeCloseTo(expectedDeg, 6);
  });

  it('increases as target height increases at a fixed distance', () => {
    const low = apparentElevationDeg(0, 100, 5000);
    const high = apparentElevationDeg(0, 500, 5000);
    expect(high).toBeGreaterThan(low);
  });
});

describe('terrainHorizonProfile on a flat plane', () => {
  it('reads a small negative dip everywhere, not 0, given the observer\'s own eye height', () => {
    const profile = terrainHorizonProfile(0, 0, 0, 0, 90, {
      elevationAt: () => 0,
      stepM: 1000,
      maxDistanceM: 20_000,
      azimuthStepDeg: 30,
    });
    expect(profile.length).toBeGreaterThan(0);
    for (const p of profile) {
      expect(p.terrainAltitudeDeg).toBeLessThan(0);
      expect(p.terrainAltitudeDeg).toBeGreaterThan(-1); // a dip of a few arcmin, not degrees
    }
  });

  it('produces ~0° (matching the observer\'s own height) when observer and plane are level', () => {
    // Cancel the eye-height dip by starting the observer already
    // EYE_HEIGHT_M below "the plane" it's standing on relative to sea
    // level -- isolates the curvature/refraction term from the eye-height
    // offset, which the flat-plane fixture above intentionally includes.
    const profile = terrainHorizonProfile(0, 0, -EYE_HEIGHT_M, 0, 0, {
      elevationAt: () => 0,
      stepM: 500,
      maxDistanceM: 2000,
    });
    expect(profile[0].terrainAltitudeDeg).toBeCloseTo(0, 2);
  });
});

describe('terrainHorizonProfile with a synthetic ring wall', () => {
  const WALL_DISTANCE_M = 10_000;
  const WALL_HEIGHT_M = 300;
  const WALL_HALF_THICKNESS_M = 150;

  // Observer at the equator/prime meridian so a flat-Earth planar
  // approximation is clean for this small-scale (tens of km) fixture --
  // deliberately NOT reusing horizon.ts's own destinationPoint, so this is
  // an independent check of the ray-march + max-angle-wins logic, not a
  // test of the module against itself.
  function ringWallElevation(lat: number, lon: number): number {
    const R = 6_371_000;
    const dLatM = lat * (Math.PI / 180) * R;
    const dLonM = lon * (Math.PI / 180) * R; // cos(0) = 1 at the equator
    const distM = Math.hypot(dLatM, dLonM);
    return Math.abs(distM - WALL_DISTANCE_M) <= WALL_HALF_THICKNESS_M ? WALL_HEIGHT_M : 0;
  }

  it('finds the wall at its known distance/height, matching the hand-computed angle', () => {
    const profile = terrainHorizonProfile(0, 0, 0, 0, 360, {
      elevationAt: ringWallElevation,
      stepM: 100,
      maxDistanceM: 20_000,
      azimuthStepDeg: 45,
    });
    const expectedDeg = apparentElevationDeg(EYE_HEIGHT_M, WALL_HEIGHT_M, WALL_DISTANCE_M);
    for (const p of profile) {
      expect(p.terrainAltitudeDeg).toBeCloseTo(expectedDeg, 1);
    }
  });

  it('sees nothing (a small negative dip) once the ray-march cutoff is short of the wall', () => {
    const profile = terrainHorizonProfile(0, 0, 0, 0, 0, {
      elevationAt: ringWallElevation,
      stepM: 100,
      maxDistanceM: 5000, // well short of WALL_DISTANCE_M
    });
    expect(profile[0].terrainAltitudeDeg).toBeLessThan(0);
  });
});

describe('terrainHorizonProfile azimuth window handling', () => {
  it('spans azMinDeg..azMaxDeg with the requested step', () => {
    const profile = terrainHorizonProfile(0, 0, 0, 280, 320, {
      elevationAt: () => 0,
      stepM: 5000,
      maxDistanceM: 5000,
      azimuthStepDeg: 10,
    });
    expect(profile[0].azimuthDeg).toBeCloseTo(280, 6);
    expect(profile[profile.length - 1].azimuthDeg).toBeCloseTo(320, 6);
    expect(profile.length).toBe(5); // 280,290,300,310,320
  });

  it('wraps through 360 when azMaxDeg < azMinDeg', () => {
    const profile = terrainHorizonProfile(0, 0, 0, 350, 10, {
      elevationAt: () => 0,
      stepM: 5000,
      maxDistanceM: 5000,
      azimuthStepDeg: 10,
    });
    expect(profile[0].azimuthDeg).toBeCloseTo(350, 6);
    expect(profile[profile.length - 1].azimuthDeg).toBeCloseTo(10, 6);
  });
});

describe('checkHorizonObstruction', () => {
  const flatProfile: HorizonPoint[] = [
    { azimuthDeg: 270, terrainAltitudeDeg: 2 },
    { azimuthDeg: 300, terrainAltitudeDeg: 2 },
    { azimuthDeg: 330, terrainAltitudeDeg: 8 },
  ];

  function contact(key: string, altitudeDeg: number, azimuthDeg: number): ContactSunPosition {
    return { key, time: new Date('2026-08-12T18:00:00Z'), altitudeDeg, azimuthDeg };
  }

  it('reports clear when the Sun is above the terrain at its azimuth', () => {
    const [result] = checkHorizonObstruction(flatProfile, [contact('c1', 10, 280)]);
    expect(result.obstructed).toBe(false);
    expect(result.terrainAltitudeDeg).toBeCloseTo(2, 6);
  });

  it('reports obstructed when the Sun is below the terrain at its azimuth', () => {
    const [result] = checkHorizonObstruction(flatProfile, [contact('c4', 5, 325)]);
    expect(result.obstructed).toBe(true);
  });

  it('reports a mix across contacts -- some clear, some blocked', () => {
    const results = checkHorizonObstruction(flatProfile, [
      contact('c2', 6, 280), // clear: terrain ~2deg
      contact('c3', 3, 335), // blocked: terrain ~8deg
    ]);
    expect(results.map((r) => r.obstructed)).toEqual([false, true]);
  });

  it('treats exactly-equal altitude as obstructed (the boundary case)', () => {
    const [result] = checkHorizonObstruction(flatProfile, [contact('max', 2, 270)]);
    expect(result.obstructed).toBe(true);
  });
});
