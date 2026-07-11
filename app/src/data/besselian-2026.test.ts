// End-to-end check for the actual shipped data file (not a test-only
// fixture): loads besselian-2026.json the same way the real app will,
// runs it through the real eclipse-core modules, and confirms it
// reproduces Calamocha's already-verified totality figures (C2 18:30:10,
// C3 18:31:52 UT, 101.6s -- see docs/PYTHON_REVIEW_FINDINGS.md and
// app/test/fixtures/golden-vectors.json). Closes the loop from
// tools/build-data through to a known-correct real-world answer.

import { describe, expect, it } from 'vitest';
import besselian from './besselian-2026.json';
import { findContactTimes, findMaximumTime } from '../eclipse/localCircumstances';
import type { BesselianCoefficients } from '../eclipse/elements';

const CALAMOCHA = { lat: 40.92, lon: -1.3, elevationM: 884 };
const REFERENCE = {
  tMaxHours: 0.5362457893788815,
  c2Hours: 0.5221146605908871,
  c3Hours: 0.5503356233239174,
  durationS: 101.59546583890915,
};

describe('besselian-2026.json', () => {
  it('has the locked DeltaT and a coefficient for all eight elements', () => {
    expect(besselian.delta_t_seconds).toBe(69.1);
    for (const key of ['x', 'y', 'd', 'mu0', 'l1', 'l2', 'tanf1', 'tanf2']) {
      expect(besselian.coefficients).toHaveProperty(key);
      expect(besselian.coefficients[key as keyof typeof besselian.coefficients]).toHaveLength(4);
    }
  });

  it('reproduces Calamocha\'s known-correct totality figures end-to-end', () => {
    const coefficients = besselian.coefficients as unknown as BesselianCoefficients;
    const tMax = findMaximumTime(coefficients, CALAMOCHA.lat, CALAMOCHA.lon, CALAMOCHA.elevationM);
    expect(tMax).toBeCloseTo(REFERENCE.tMaxHours, 3);

    const contacts = findContactTimes(coefficients, CALAMOCHA.lat, CALAMOCHA.lon, CALAMOCHA.elevationM, tMax);
    expect(contacts.c2).not.toBeNull();
    expect(contacts.c3).not.toBeNull();
    expect(contacts.c2!).toBeCloseTo(REFERENCE.c2Hours, 5);
    expect(contacts.c3!).toBeCloseTo(REFERENCE.c3Hours, 5);

    const durationS = (contacts.c3! - contacts.c2!) * 3600;
    expect(durationS).toBeCloseTo(REFERENCE.durationS, 0);
  });
});
