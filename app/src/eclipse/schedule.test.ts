import { describe, expect, it } from 'vitest';
import { isBeforeSunsetCutoff, observableEvents } from './schedule';
import type { LocalCircumstances } from '../stores/localCircumstances';

const D = (iso: string) => new Date(iso);
const MAX = D('2026-08-12T18:29:00Z');

function lc(overrides: Partial<LocalCircumstances> = {}): LocalCircumstances {
  return {
    max: MAX,
    c1: D('2026-08-12T17:20:00Z'),
    c2: D('2026-08-12T18:26:00Z'),
    c3: D('2026-08-12T18:33:00Z'),
    c4: D('2026-08-12T19:35:00Z'),
    durationS: 420,
    sunset: null,
    ...overrides,
  };
}

describe('observableEvents', () => {
  it('ordinary fully-observable case: all six in ascending order (no sunset cutoff)', () => {
    const events = observableEvents(lc({ sunset: D('2026-08-12T21:00:00Z') }));
    expect(events.map((e) => e.key)).toEqual(['c1', 'c2', 'max', 'c3', 'c4', 'sunset']);
  });

  it('no-totality: c2/c3 null are simply absent, c1/max/c4 remain', () => {
    const events = observableEvents(lc({ c2: null, c3: null, durationS: null }));
    expect(events.map((e) => e.key)).toEqual(['c1', 'max', 'c4']);
  });

  it('all-null contacts (max is never null): only max remains observable', () => {
    const events = observableEvents(lc({ c1: null, c2: null, c3: null, c4: null, durationS: null }));
    expect(events.map((e) => e.key)).toEqual(['max']);
  });

  it('sunset before c1: nothing observable except sunset itself', () => {
    const events = observableEvents(lc({ sunset: D('2026-08-12T17:00:00Z') }));
    expect(events.map((e) => e.key)).toEqual(['sunset']);
  });

  it('sunset between c1 and c2: skips straight to sunset, c2/max/c3/c4 dropped', () => {
    const events = observableEvents(lc({ sunset: D('2026-08-12T17:50:00Z') }));
    expect(events.map((e) => e.key)).toEqual(['c1', 'sunset']);
  });

  it('sunset exactly equal to a contact time keeps that contact (<=, not <)', () => {
    const events = observableEvents(lc({ sunset: D('2026-08-12T18:26:00Z') }));
    expect(events.map((e) => e.key)).toEqual(['c1', 'c2', 'sunset']);
  });

  it('sunset well after c4: every contact observable, sunset last', () => {
    const events = observableEvents(lc({ sunset: D('2026-08-12T21:00:00Z') }));
    expect(events[events.length - 1].key).toBe('sunset');
  });

  // These two pin the sunset-ordering invariant CountdownPanel's own
  // 'dual' mode boundary depends on (sunset never sorts before a
  // surviving c2/max/c3), at the two positions that boundary actually
  // cares about -- not just the c1/c2 position already covered above.
  it('sunset between c2 and max: dual-mode window itself gets cut short', () => {
    const events = observableEvents(lc({ sunset: D('2026-08-12T18:27:00Z') }));
    expect(events.map((e) => e.key)).toEqual(['c1', 'c2', 'sunset']);
  });

  it('sunset between max and c3: max observable, c3 dropped', () => {
    const events = observableEvents(lc({ sunset: D('2026-08-12T18:30:00Z') }));
    expect(events.map((e) => e.key)).toEqual(['c1', 'c2', 'max', 'sunset']);
  });

  it('no-totality combined with a mid-sequence sunset (previously only tested independently)', () => {
    const events = observableEvents(
      lc({ c2: null, c3: null, durationS: null, sunset: D('2026-08-12T17:30:00Z') }),
    );
    expect(events.map((e) => e.key)).toEqual(['c1', 'sunset']);
  });
});

describe('isBeforeSunsetCutoff', () => {
  it('sunset itself is always observable, regardless of the sunset value passed', () => {
    expect(isBeforeSunsetCutoff('sunset', 999_999, 0)).toBe(true);
  });

  it('no sunset cutoff (null) -> always observable', () => {
    expect(isBeforeSunsetCutoff('c3', 999_999, null)).toBe(true);
  });

  it('at or before sunset -> observable', () => {
    expect(isBeforeSunsetCutoff('c3', 100, 100)).toBe(true);
    expect(isBeforeSunsetCutoff('c3', 99, 100)).toBe(true);
  });

  it('after sunset -> not observable', () => {
    expect(isBeforeSunsetCutoff('c3', 101, 100)).toBe(false);
  });

  it('is unit-agnostic (works identically for seconds, matching TimeBar\'s own internal representation)', () => {
    expect(isBeforeSunsetCutoff('c4', 1_000, 999)).toBe(false);
    expect(isBeforeSunsetCutoff('c4', 999, 1_000)).toBe(true);
  });
});
