import { describe, expect, it } from 'vitest';
import { c1Phrase, c2Phrase, c3Phrase, FILTERS_ON_PHRASE, MAX_PHRASE } from './phrases';

describe('c1Phrase', () => {
  it('keeps "seconds" but drops "to C1" on the closest two rungs', () => {
    expect(c1Phrase(300)).toBe('Five minutes to C1.');
    expect(c1Phrase(60)).toBe('One minute to C1.');
    expect(c1Phrase(30)).toBe('Thirty seconds to C1.');
    expect(c1Phrase(10)).toBe('Ten seconds.');
    expect(c1Phrase(5)).toBe('Five seconds.');
  });

  it('throws for an undefined lead time', () => {
    expect(() => c1Phrase(15)).toThrow();
  });
});

describe('c2Phrase', () => {
  it('drops both "seconds" and "to C2" on the closest three rungs', () => {
    expect(c2Phrase(600)).toBe('Ten minutes to C2.');
    expect(c2Phrase(300)).toBe('Five minutes to C2.');
    expect(c2Phrase(120)).toBe('Two minutes to C2.');
    expect(c2Phrase(60)).toBe('One minute to C2.');
    expect(c2Phrase(30)).toBe('Thirty seconds.');
    expect(c2Phrase(15)).toBe('Fifteen, filters off!');
    expect(c2Phrase(10)).toBe('Ten.');
    expect(c2Phrase(5)).toBe('Five.');
  });

  it('throws for an undefined lead time', () => {
    expect(() => c2Phrase(45)).toThrow();
  });
});

describe('c3Phrase', () => {
  it('plain wording throughout, "seconds" drops on the closest three rungs', () => {
    expect(c3Phrase(50)).toBe('Fifty seconds.');
    expect(c3Phrase(30)).toBe('Thirty seconds.');
    expect(c3Phrase(15)).toBe('Fifteen.');
    expect(c3Phrase(10)).toBe('Ten.');
    expect(c3Phrase(5)).toBe('Five.');
  });

  it('throws for an undefined lead time', () => {
    expect(() => c3Phrase(300)).toThrow();
  });
});

describe('standalone phrases', () => {
  it('Max is unconditional, no numeric lead', () => {
    expect(MAX_PHRASE).toBe('Maximum.');
  });

  it('filters-on has no countdown number', () => {
    expect(FILTERS_ON_PHRASE).toBe('Filters on!');
  });
});
