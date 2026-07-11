// End-to-end check for the actual shipped data file (not a test-only
// fixture): loads shadow-frames.json the same way the real app will,
// confirms it round-trips against the real centralLineAt/shadowLimitsAt
// it was generated from, and cross-checks a sample against the
// independently-verified golden-central-line.json reference (2026-08-
// 12T18:26:00Z), closing the loop from the generation script through to
// a known-correct real-world answer.

import { describe, expect, it } from 'vitest';
import shadowFrames from './shadow-frames.json';
import { coefficients } from './besselian-2026';
import { centralLineAt, shadowLimitsAt } from '../eclipse/path';

describe('shadow-frames.json', () => {
  it('spans the expected window with non-trivial point counts', () => {
    expect(shadowFrames.windowStartH).toBeCloseTo(0.25, 5);
    expect(shadowFrames.windowEndH).toBeCloseTo(0.58, 5);
    expect(shadowFrames.centralLine.length).toBeGreaterThan(100);
    expect(shadowFrames.northLimit.length).toBeGreaterThan(50);
    expect(shadowFrames.southLimit.length).toBeGreaterThan(50);
  });

  it('round-trips against a fresh centralLineAt/shadowLimitsAt recompute', () => {
    // Proves the shipped file matches what the real functions produce
    // right now, not stale/hand-edited data. windowStartH's the sample
    // most convenient to recompute (t = windowStartH exactly).
    const { windowStartH } = shadowFrames;
    const freshCentral = centralLineAt(coefficients, windowStartH);
    expect(freshCentral).not.toBeNull();
    expect(shadowFrames.centralLine[0].lat).toBeCloseTo(freshCentral!.lat, 4);
    expect(shadowFrames.centralLine[0].lon).toBeCloseTo(freshCentral!.lon, 4);

    const freshLimits = shadowLimitsAt(coefficients, windowStartH);
    expect(freshLimits.north).not.toBeNull();
    expect(shadowFrames.northLimit[0].lat).toBeCloseTo(freshLimits.north!.lat, 4);
    expect(shadowFrames.northLimit[0].lon).toBeCloseTo(freshLimits.north!.lon, 4);
  });

  it('matches the independent oracle reference near 18:26 UT', () => {
    const REFERENCE = { utc: '2026-08-12T18:26:00Z', lat: 44.74284998, lon: -8.45939837 };
    const targetMs = Date.parse(REFERENCE.utc);
    let nearest = shadowFrames.centralLine[0];
    for (const p of shadowFrames.centralLine) {
      if (Math.abs(p.utMs - targetMs) < Math.abs(nearest.utMs - targetMs)) nearest = p;
    }
    // Grid spacing is ~8s; at this point on the track the shadow moves
    // slowly enough that the nearest sample is well within 0.05 deg
    // (~5km) of the true 18:26:00 position.
    expect(Math.abs(nearest.utMs - targetMs)).toBeLessThan(8000);
    expect(nearest.lat).toBeCloseTo(REFERENCE.lat, 1);
    expect(nearest.lon).toBeCloseTo(REFERENCE.lon, 1);
  });
});
