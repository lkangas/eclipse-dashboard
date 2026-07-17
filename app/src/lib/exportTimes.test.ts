import { describe, expect, it } from 'vitest';
import { buildTimesJson } from './exportTimes';
import { formatIsoTenths } from './format';

describe('formatIsoTenths', () => {
  it('formats with one decimal, UTC, Z suffix', () => {
    expect(formatIsoTenths(new Date('2024-04-08T17:22:44.800Z'))).toBe('2024-04-08T17:22:44.8Z');
  });

  it('rounds to the nearest tenth', () => {
    expect(formatIsoTenths(new Date('2024-04-08T17:22:44.840Z'))).toBe('2024-04-08T17:22:44.8Z');
    expect(formatIsoTenths(new Date('2024-04-08T17:22:44.860Z'))).toBe('2024-04-08T17:22:44.9Z');
  });

  it('carries into the next second when rounding reaches .10', () => {
    expect(formatIsoTenths(new Date('2024-04-08T17:22:44.960Z'))).toBe('2024-04-08T17:22:45.0Z');
  });

  it('carries across minute/hour/day boundaries too', () => {
    expect(formatIsoTenths(new Date('2024-04-08T23:59:59.960Z'))).toBe('2024-04-09T00:00:00.0Z');
  });
});

describe('buildTimesJson', () => {
  // Real data pulled directly from
  // github.com/komakallio/eclipse2024/blob/main/times.json -- a genuine
  // cross-check against the actual third-party schema, not just an
  // arbitrary self-consistency test.
  it('matches the komakallio/eclipse2024 times.json schema exactly', () => {
    const json = buildTimesJson(
      new Date('2024-04-08T17:22:44.8Z'),
      new Date('2024-04-08T18:40:04.0Z'),
      new Date('2024-04-08T18:42:15.3Z'),
      new Date('2024-04-08T18:44:26.5Z'),
      new Date('2024-04-08T20:02:28.6Z'),
    );
    expect(json).toEqual({
      times: {
        C1: '2024-04-08T17:22:44.8Z',
        C2: '2024-04-08T18:40:04.0Z',
        MAX: '2024-04-08T18:42:15.3Z',
        C3: '2024-04-08T18:44:26.5Z',
        C4: '2024-04-08T20:02:28.6Z',
      },
    });
  });

  it('exports C2/C3 as null for a partial-only observer, C1/C4/MAX still present', () => {
    const json = buildTimesJson(
      new Date('2024-04-08T17:22:44.8Z'),
      null,
      new Date('2024-04-08T18:42:15.3Z'),
      null,
      new Date('2024-04-08T20:02:28.6Z'),
    );
    expect(json).toEqual({
      times: {
        C1: '2024-04-08T17:22:44.8Z',
        C2: null,
        MAX: '2024-04-08T18:42:15.3Z',
        C3: null,
        C4: '2024-04-08T20:02:28.6Z',
      },
    });
  });
});
