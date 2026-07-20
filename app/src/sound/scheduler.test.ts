import { describe, expect, it } from 'vitest';
import { initialSchedulerState, tick, type SchedulableEvent } from './scheduler';

const D = (iso: string) => new Date(iso);
const T0 = D('2026-08-12T18:00:00.000Z').getTime();

const events: SchedulableEvent[] = [
  { id: 'c1', time: D('2026-08-12T18:10:00.000Z') },
  { id: 'c2', time: D('2026-08-12T18:20:00.000Z') },
  { id: 'max', time: D('2026-08-12T18:21:00.000Z') },
  { id: 'c3', time: D('2026-08-12T18:22:00.000Z') },
  { id: 'c4', time: D('2026-08-12T19:00:00.000Z') },
];

describe('tick', () => {
  it('no motion (curMs === lastEffectiveMs): no-op, nothing fires', () => {
    const s0 = initialSchedulerState(T0);
    const { state, toFire } = tick(s0, T0, events);
    expect(toFire).toEqual([]);
    expect(state.lastEffectiveMs).toBe(T0);
  });

  it('forward, zero events crossed: fires nothing, state still advances', () => {
    const s0 = initialSchedulerState(T0);
    const { state, toFire } = tick(s0, T0 + 1000, events);
    expect(toFire).toEqual([]);
    expect(state.lastEffectiveMs).toBe(T0 + 1000);
  });

  it('forward, exactly one event crossed: fires it', () => {
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const { toFire } = tick(s0, events[0].time.getTime(), events);
    expect(toFire.map((e) => e.id)).toEqual(['c1']);
  });

  it('does not re-fire an already-fired event on a later tick', () => {
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const r1 = tick(s0, events[0].time.getTime(), events);
    expect(r1.toFire.map((e) => e.id)).toEqual(['c1']);
    const r2 = tick(r1.state, events[0].time.getTime() + 60_000, events);
    expect(r2.toFire).toEqual([]);
  });

  it('forward multi-crossing in one step: fires only the most-recently-passed TIME, silently marks earlier ones fired', () => {
    // Jump straight from before c1 to after c4 -- a big sim fast-forward.
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const { state, toFire } = tick(s0, events[events.length - 1].time.getTime() + 1000, events);
    expect(toFire.map((e) => e.id)).toEqual(['c4']);
    // All of them marked fired, not just c4 -- none should fire again later.
    for (const e of events) expect(state.fired.has(e.id)).toBe(true);
  });

  it('collapse picks the most-recently-passed TIME, not the last array element (regression pin)', () => {
    // Deliberately out of chronological order -- if a future refactor
    // ever collapsed by array position instead of by time, this would
    // catch it (the array's last element here, c2, is NOT the latest
    // time).
    const shuffled = [events[4], events[0], events[2], events[3], events[1]];
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const { toFire } = tick(s0, events[events.length - 1].time.getTime() + 1000, shuffled);
    expect(toFire.map((e) => e.id)).toEqual(['c4']);
  });

  it('same-instant companion pair (docs/SOUND-PLAN.md §2.3\'s C2/C3 tone+speech entries): both fire, in one ordinary tick, not just one', () => {
    const sameInstant: SchedulableEvent[] = [
      { id: 'c2:instant:tone', time: events[1].time },
      { id: 'c2:instant:speech', time: events[1].time },
    ];
    const s0 = initialSchedulerState(events[1].time.getTime() - 1000);
    const { state, toFire } = tick(s0, events[1].time.getTime(), sameInstant);
    expect(toFire.map((e) => e.id).sort()).toEqual(['c2:instant:speech', 'c2:instant:tone']);
    expect(state.fired.has('c2:instant:tone')).toBe(true);
    expect(state.fired.has('c2:instant:speech')).toBe(true);
  });

  it('realistic 1Hz live-mode walk: a full 5-event schedule each fires exactly once, in order, with no misses or duplicates', () => {
    let state = initialSchedulerState(events[0].time.getTime() - 5000);
    const firedOrder: string[] = [];
    const endMs = events[events.length - 1].time.getTime() + 5000;
    for (let t = state.lastEffectiveMs; t <= endMs; t += 1000) {
      const result = tick(state, t, events);
      state = result.state;
      firedOrder.push(...result.toFire.map((e) => e.id));
    }
    expect(firedOrder).toEqual(['c1', 'c2', 'max', 'c3', 'c4']);
  });

  it('an event already in the past at initialization never fires', () => {
    // Scheduler created AFTER c1 has already passed.
    const s0 = initialSchedulerState(events[0].time.getTime() + 60_000);
    const { toFire } = tick(s0, events[0].time.getTime() + 120_000, events);
    expect(toFire.map((e) => e.id)).not.toContain('c1');
  });

  it('window is (lastEffectiveMs, curMs] -- inclusive upper bound', () => {
    const s0 = initialSchedulerState(events[0].time.getTime() - 1);
    const { toFire } = tick(s0, events[0].time.getTime(), events);
    expect(toFire.map((e) => e.id)).toEqual(['c1']);
  });

  it('window is (lastEffectiveMs, curMs] -- exclusive lower bound (already-passed instant does not refire this tick)', () => {
    const s0 = initialSchedulerState(events[0].time.getTime());
    const { toFire } = tick(s0, events[0].time.getTime(), events);
    expect(toFire).toEqual([]);
  });

  it('backward scrub: clears fired for events after the new instant, fires nothing itself', () => {
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const past2 = tick(s0, events[1].time.getTime() + 1000, events); // fires c1, then c2
    expect(past2.state.fired.has('c1')).toBe(true);
    expect(past2.state.fired.has('c2')).toBe(true);

    const scrubBack = tick(past2.state, events[0].time.getTime() - 1000, events);
    expect(scrubBack.toFire).toEqual([]);
    expect(scrubBack.state.fired.has('c1')).toBe(false);
    expect(scrubBack.state.fired.has('c2')).toBe(false);
  });

  it('backward scrub does not clear fired events still before the new (earlier) instant', () => {
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const past2 = tick(s0, events[1].time.getTime() + 1000, events); // fires c1, then c2

    // Scrub back to between c1 and c2 -- c1 stays fired (still in the past), c2 clears.
    const scrubBack = tick(past2.state, events[0].time.getTime() + 1000, events);
    expect(scrubBack.state.fired.has('c1')).toBe(true);
    expect(scrubBack.state.fired.has('c2')).toBe(false);
  });

  it('round trip: scrub back past an event then forward again -- fires twice, once per forward crossing', () => {
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const first = tick(s0, events[0].time.getTime(), events);
    expect(first.toFire.map((e) => e.id)).toEqual(['c1']);

    const scrubBack = tick(first.state, events[0].time.getTime() - 1000, events);
    expect(scrubBack.state.fired.has('c1')).toBe(false);

    const second = tick(scrubBack.state, events[0].time.getTime(), events);
    expect(second.toFire.map((e) => e.id)).toEqual(['c1']);
  });

  it('an id from a prior tick not found in the current events list is conservatively kept fired on a backward step', () => {
    const s0 = initialSchedulerState(events[0].time.getTime() - 5000);
    const fired = tick(s0, events[0].time.getTime(), events);
    // Simulate a stale id no longer present in the current list.
    const staleState = { ...fired.state, fired: new Set([...fired.state.fired, 'ghost']) };
    const scrubBack = tick(staleState, events[0].time.getTime() - 1000, events);
    expect(scrubBack.state.fired.has('ghost')).toBe(true);
  });
});
