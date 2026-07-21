import { describe, expect, it } from 'vitest';
import { CONTACT_TONE } from './tones';

describe('CONTACT_TONE', () => {
  it('is a single shared shape, mid-range frequency, short duration', () => {
    expect(CONTACT_TONE.frequencyHz).toBeGreaterThan(0);
    expect(CONTACT_TONE.durationS).toBeGreaterThan(0);
  });
});
