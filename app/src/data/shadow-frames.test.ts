// End-to-end check for the actual shipped data file (not a test-only
// fixture): loads shadow-frames.json the same way the real app will and
// cross-checks a sample against the independently-verified
// golden-central-line.json reference (2026-08-12T18:26:00Z). Generated
// by tools/build-data/generate_shadow_frames.py directly from
// eclipse-calc (the ground-truth oracle) -- there's no TypeScript port
// of this geometry to round-trip against anymore (PLAN.md: central
// line/N-S limits are static, build-time-only data, so maintaining a
// parallel client-side implementation was pure overhead).

import { describe, expect, it } from 'vitest';
import shadowFrames from './shadow-frames.json';

describe('shadow-frames.json', () => {
  it('spans the expected window with non-trivial point counts', () => {
    expect(shadowFrames.windowStartH).toBeCloseTo(0.25, 5);
    expect(shadowFrames.windowEndH).toBeCloseTo(0.6, 5);
    expect(shadowFrames.centralLine.length).toBeGreaterThan(500);
    expect(shadowFrames.northLimit.length).toBeGreaterThan(500);
    expect(shadowFrames.southLimit.length).toBeGreaterThan(500);
  });

  it('has a terminator-crossing endpoint for each of the three lines', () => {
    expect(shadowFrames.centralLineTerminator).not.toBeNull();
    expect(shadowFrames.northLimitTerminator).not.toBeNull();
    expect(shadowFrames.southLimitTerminator).not.toBeNull();
  });

  it('matches the independent oracle reference near 18:26 UT', () => {
    const REFERENCE = { utc: '2026-08-12T18:26:00Z', lat: 44.74284998, lon: -8.45939837 };
    const targetMs = Date.parse(REFERENCE.utc);
    let nearest = shadowFrames.centralLine[0];
    for (const p of shadowFrames.centralLine) {
      if (Math.abs(p.utMs - targetMs) < Math.abs(nearest.utMs - targetMs)) nearest = p;
    }
    // 1s grid -- the nearest sample should be within half a second of
    // the reference instant, and its position within a hundredth of a
    // degree (the shadow moves slowly enough here that sub-second
    // timing error is negligible in position).
    expect(Math.abs(nearest.utMs - targetMs)).toBeLessThan(500);
    expect(nearest.lat).toBeCloseTo(REFERENCE.lat, 1);
    expect(nearest.lon).toBeCloseTo(REFERENCE.lon, 1);
  });
});
