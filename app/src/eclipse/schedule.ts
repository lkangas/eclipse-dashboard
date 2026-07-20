// Faithful extraction of the "is this contact observable" rule that was
// independently reimplemented three times (CountdownPanel.svelte,
// ContactsPanel.svelte, TimeBar.svelte) -- this event is sunset-limited for
// Spain (PLAN.md §1), and the Besselian shadow-cone geometry has no concept
// of the horizon at all, so any of C2/Max/C3/C4 can legitimately fall after
// the observer's own local sunset. A contact past sunset isn't observable;
// sunset itself always is, whenever it exists for this observer.
import type { LocalCircumstances } from '../stores/localCircumstances';

export type EventKey = 'c1' | 'c2' | 'max' | 'c3' | 'c4' | 'sunset';

export interface ScheduledEvent {
  key: EventKey;
  time: Date;
}

/** Whether a contact at `timeMs` counts as observable given `sunsetMs` --
 * true for sunset itself unconditionally, otherwise true iff at or before
 * sunset (or this observer has no sunset cutoff at all, i.e. `sunsetMs` is
 * null). Unit-agnostic: pass epoch ms or epoch seconds, as long as both
 * arguments use the same unit -- TimeBar.svelte works in seconds
 * internally and applies this directly to its own fallback-substituted
 * c1/c4 placeholders, which is why this stays a raw numeric predicate
 * rather than only existing inside observableEvents() below. */
export function isBeforeSunsetCutoff(
  key: EventKey,
  timeMs: number,
  sunsetMs: number | null,
): boolean {
  return key === 'sunset' || sunsetMs === null || timeMs <= sunsetMs;
}

/** The observable events for this observer, ascending by time -- null
 * contacts (e.g. c2/c3 outside the umbral path) are simply absent, and any
 * non-null contact past local sunset is dropped (sunset itself is kept
 * whenever it exists, per isBeforeSunsetCutoff above). */
export function observableEvents(lc: LocalCircumstances): ScheduledEvent[] {
  const sunsetMs = lc.sunset ? lc.sunset.getTime() : null;
  const candidates: { key: EventKey; time: Date | null }[] = [
    { key: 'c1', time: lc.c1 },
    { key: 'c2', time: lc.c2 },
    { key: 'max', time: lc.max },
    { key: 'c3', time: lc.c3 },
    { key: 'c4', time: lc.c4 },
    { key: 'sunset', time: lc.sunset },
  ];
  return candidates
    .filter((c): c is { key: EventKey; time: Date } => c.time !== null)
    .filter((c) => isBeforeSunsetCutoff(c.key, c.time.getTime(), sunsetMs))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}
