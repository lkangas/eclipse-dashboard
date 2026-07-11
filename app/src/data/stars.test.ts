// Validates the actual shipped star catalog (not a copy).

import { describe, expect, it } from 'vitest';
import stars from './stars.json';

describe('stars.json', () => {
  it('is filtered to mag < 3, brightest first, and excludes the Sun', () => {
    expect(stars.count).toBe(stars.stars.length);
    expect(stars.stars.length).toBeGreaterThan(100);
    expect(stars.stars.length).toBeLessThan(300); // sanity bound, not exact

    for (const star of stars.stars) {
      expect(star.mag).toBeLessThan(3);
    }
    for (let i = 1; i < stars.stars.length; i++) {
      expect(stars.stars[i].mag).toBeGreaterThanOrEqual(stars.stars[i - 1].mag);
    }
    expect(stars.stars.some((s) => s.proper === 'Sol')).toBe(false);
  });

  it('includes well-known bright stars at their real positions/magnitudes', () => {
    const byName = Object.fromEntries(stars.stars.map((s) => [s.proper, s]));

    expect(byName.Sirius).toBeDefined();
    expect(byName.Sirius.mag).toBeCloseTo(-1.44, 1);
    expect(byName.Sirius.ra).toBeCloseTo(6.75, 1); // hours
    expect(byName.Sirius.dec).toBeCloseTo(-16.7, 0); // degrees

    // Sirius must be the single brightest entry.
    expect(stars.stars[0].proper).toBe('Sirius');

    expect(byName.Canopus).toBeDefined();
    expect(byName.Arcturus).toBeDefined();
    expect(byName.Vega).toBeDefined();
  });
});
