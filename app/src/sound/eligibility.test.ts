import { describe, expect, it } from 'vitest';
import { soundEligibleEvents } from './eligibility';
import type { LocalCircumstances } from '../stores/localCircumstances';

const D = (iso: string) => new Date(iso);
const MAX = D('2026-08-12T18:29:00Z');
const C2 = D('2026-08-12T18:26:00Z');
const C3 = D('2026-08-12T18:33:00Z');

function lc(overrides: Partial<LocalCircumstances> = {}): LocalCircumstances {
  return {
    max: MAX,
    c1: D('2026-08-12T17:20:00Z'),
    c2: C2,
    c3: C3,
    c4: D('2026-08-12T19:35:00Z'),
    durationS: (C3.getTime() - C2.getTime()) / 1000,
    sunset: D('2026-08-12T21:00:00Z'), // well after c4 -- fully observable event
    ...overrides,
  };
}

describe('soundEligibleEvents -- full totality, everything observable', () => {
  const events = soundEligibleEvents(lc());

  it('C1 expands to 5 countdown rungs + 1 tone', () => {
    const c1Events = events.filter((e) => e.key === 'c1');
    expect(c1Events).toHaveLength(6);
    expect(c1Events.filter((e) => e.channel === 'tone')).toHaveLength(1);
    expect(c1Events.filter((e) => e.channel === 'speech')).toHaveLength(5);
  });

  it('C2 expands to 8 countdown rungs + 1 tone, with the 15s rung carrying the filters-off wording', () => {
    const c2Events = events.filter((e) => e.key === 'c2');
    expect(c2Events).toHaveLength(9);
    expect(c2Events.filter((e) => e.channel === 'tone')).toHaveLength(1);
    const fifteenRung = c2Events.find(
      (e) => e.time.getTime() === C2.getTime() - 15_000,
    );
    expect(fifteenRung?.phrase).toBe('Fifteen, filters off!');
    expect(fifteenRung?.channel).toBe('speech');
  });

  it('Max fires unconditionally, even with a fully-observable totality (Rule 3, repealed suppression)', () => {
    const maxEvents = events.filter((e) => e.key === 'max');
    expect(maxEvents).toHaveLength(1);
    expect(maxEvents[0].phrase).toBe('Maximum.');
    expect(maxEvents[0].time.getTime()).toBe(MAX.getTime());
  });

  it('C3 expands to 5 countdown rungs + 1 tone + 1 standalone filters-on event at C3+15s', () => {
    const c3Events = events.filter((e) => e.key === 'c3');
    expect(c3Events).toHaveLength(7);
    expect(c3Events.filter((e) => e.channel === 'tone')).toHaveLength(1);
    const filtersOn = c3Events.find((e) => e.phrase === 'Filters on!');
    expect(filtersOn).toBeDefined();
    expect(filtersOn!.time.getTime()).toBe(C3.getTime() + 15_000);
    expect(filtersOn!.channel).toBe('speech');
    expect(filtersOn!.prewarn).toBe(false);
  });

  it('C4 and Sunset never appear, even though both are fully observable (Rule 1)', () => {
    expect(events.some((e) => (e.key as string) === 'c4')).toBe(false);
    expect(events.some((e) => (e.key as string) === 'sunset')).toBe(false);
  });

  it('every event has a unique id', () => {
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is sorted ascending by time', () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time.getTime()).toBeGreaterThanOrEqual(events[i - 1].time.getTime());
    }
  });

  it('total count matches 6 (C1) + 9 (C2) + 1 (Max) + 7 (C3) = 23', () => {
    expect(events).toHaveLength(23);
  });
});

describe('soundEligibleEvents -- no totality (c2/c3 null)', () => {
  const events = soundEligibleEvents(lc({ c2: null, c3: null, durationS: null }));

  it('only C1 and Max produce events', () => {
    const keys = new Set(events.map((e) => e.key));
    expect(keys).toEqual(new Set(['c1', 'max']));
  });

  it('C1 still gets its full ladder', () => {
    expect(events.filter((e) => e.key === 'c1')).toHaveLength(6);
  });
});

describe('soundEligibleEvents -- sunset cuts off before Max (base observability rule, not a sound-specific suppression)', () => {
  it('Max produces no event when Max itself is not observable', () => {
    const events = soundEligibleEvents(lc({ sunset: D('2026-08-12T17:00:00Z') })); // before c1 (17:20)
    expect(events.some((e) => e.key === 'max')).toBe(false);
    // Nothing survives at all -- sunset is before c1 too, and sunset itself is excluded by Rule 1.
    expect(events).toHaveLength(0);
  });

  it('C1 still fires when sunset falls after C1 but before Max (a real sunset-limited case)', () => {
    const events = soundEligibleEvents(lc({ sunset: D('2026-08-12T18:15:00Z') })); // after c1, before c2/max/c3
    expect(events.some((e) => e.key === 'c1')).toBe(true);
    expect(events.some((e) => e.key === 'max')).toBe(false);
    expect(events.some((e) => e.key === 'c2')).toBe(false);
  });

  it('Max still fires when sunset falls after Max but before C3 (a real sunset-limited case)', () => {
    const events = soundEligibleEvents(lc({ sunset: D('2026-08-12T18:29:30Z'), c3: null, durationS: null }));
    expect(events.some((e) => e.key === 'max')).toBe(true);
    expect(events.some((e) => e.key === 'c3')).toBe(false);
  });
});

describe('soundEligibleEvents -- short-totality guard on C3\'s ladder', () => {
  it('drops only the longest-lead C3 rungs when durationS is short, keeps the close-in ones', () => {
    // durationS = 35s: rungs need durationS >= leadS + 10.
    // 50s -> needs 60, dropped. 30s -> needs 40, dropped. 15s -> needs 25, dropped.
    // 10s -> needs 20, dropped. 5s -> needs 15, dropped. All dropped at 35s -- pick
    // a duration that keeps some: 45s keeps 30s/15s/10s/5s (need <=35), drops 50s.
    const shortC3 = new Date(C2.getTime() + 45_000);
    const events = soundEligibleEvents(lc({ c3: shortC3, durationS: 45 }));
    const c3Speech = events.filter((e) => e.key === 'c3' && e.channel === 'speech' && e.phrase !== 'Filters on!');
    const leadsKeptS = c3Speech.map((e) => (shortC3.getTime() - e.time.getTime()) / 1000);
    expect(leadsKeptS.sort((a, b) => a - b)).toEqual([5, 10, 15, 30]);
  });

  it('never drops the C3 tone or the filters-on call, only the loose pre-warning rungs', () => {
    const shortC3 = new Date(C2.getTime() + 12_000); // pathologically short
    const events = soundEligibleEvents(lc({ c3: shortC3, durationS: 12 }));
    expect(events.some((e) => e.key === 'c3' && e.channel === 'tone')).toBe(true);
    expect(events.some((e) => e.key === 'c3' && e.phrase === 'Filters on!')).toBe(true);
  });

  it('keeps every C3 rung when durationS is null (defensive default, should not practically occur alongside a real c3)', () => {
    const events = soundEligibleEvents(lc({ durationS: null }));
    const c3Speech = events.filter((e) => e.key === 'c3' && e.channel === 'speech' && e.phrase !== 'Filters on!');
    expect(c3Speech).toHaveLength(5);
  });
});
