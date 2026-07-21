// Sound-specific layering on top of eclipse/schedule.ts's observableEvents()
// (docs/SOUND-PLAN.md §2.1/§2.3). Builds the full countdown-ladder +
// at-instant SoundEvent list for a given observer's LocalCircumstances --
// pure, no AudioContext/SpeechSynthesis/DOM dependency, feeds directly into
// sound/scheduler.ts's tick() (SoundEvent structurally satisfies that
// module's SchedulableEvent shape: an id and a time).
import { observableEvents, type EventKey } from '../eclipse/schedule';
import type { LocalCircumstances } from '../stores/localCircumstances';
import { c1Phrase, c2Phrase, c3Phrase, FILTERS_ON_PHRASE, MAX_PHRASE } from './phrases';

export type SoundEventKey = 'c1' | 'c2' | 'max' | 'c3';

export interface SoundEvent {
  /** Unique across the whole list, and stable across ticks -- what
   * sound/scheduler.ts's SchedulableEvent#id dedups on. */
  id: string;
  key: SoundEventKey;
  time: Date;
  channel: 'tone' | 'speech';
  /** true for a countdown-ladder rung; false for anything that isn't one
   * (the at-instant tone, Max's announcement, and the C3+15s filters-on
   * call are all `prewarn: false` -- the field distinguishes "counting
   * down to something" from "not", not strictly "before vs. after"). */
  prewarn: boolean;
  /** Spoken text -- null for tone-only entries (nothing to speak). */
  phrase: string | null;
}

// Lead times in seconds before the contact, per docs/SOUND-PLAN.md §2.1 --
// exact values from the brief, not rounded/approximated.
const C1_LEADS_S = [300, 60, 30, 10, 5];
const C2_LEADS_S = [600, 300, 120, 60, 30, 15, 10, 5];
const C3_LEADS_S = [50, 30, 15, 10, 5];
const FILTERS_ON_LAG_S = 15;

// Short-totality guard (docs/SOUND-PLAN.md §3.4): skip a C3 rung
// individually if it would land within GUARD_BUFFER_S seconds of C2's own
// tone (or before C2 altogether) -- durationS < leadS + GUARD_BUFFER_S.
// 10s carried forward from the plan's original design as a placeholder,
// not yet confirmed against this multi-rung ladder (docs/SOUND-PLAN.md
// §2.4 tracks this as still open).
const GUARD_BUFFER_S = 10;

function ladder(
  key: 'c1' | 'c2' | 'c3',
  contactTime: Date,
  leads: number[],
  phraseFor: (leadS: number) => string,
): SoundEvent[] {
  return leads.map((leadS) => ({
    id: `${key}:${leadS}`,
    key,
    time: new Date(contactTime.getTime() - leadS * 1000),
    channel: 'speech' as const,
    prewarn: true,
    phrase: phraseFor(leadS),
  }));
}

function toneEvent(key: 'c1' | 'c2' | 'c3', contactTime: Date): SoundEvent {
  return { id: `${key}:0`, key, time: contactTime, channel: 'tone', prewarn: false, phrase: null };
}

const SOUND_KEYS = new Set<EventKey>(['c1', 'c2', 'max', 'c3']);

/** Sound-specific eligibility (docs/SOUND-PLAN.md §2.3), layered on top of
 * observableEvents():
 * - Rule 1: c4/sunset never get sound, excluded outright even if
 *   observableEvents() itself included them -- checked first, before any
 *   other logic runs.
 * - Rule 2: never reads horizonObstruction -- true by construction, this
 *   function (and its only input, LocalCircumstances) has no such input
 *   to read in the first place.
 * - Rule 3 (repealed): no suppression logic for `max` beyond whatever
 *   observableEvents() itself already decided. If `max` isn't even
 *   observable (e.g. sunset falls before greatest eclipse), it's absent
 *   here too -- the ordinary sunset-cutoff rule, not a sound-specific
 *   suppression on top of it. */
export function soundEligibleEvents(lc: LocalCircumstances): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (const ev of observableEvents(lc)) {
    if (!SOUND_KEYS.has(ev.key)) continue; // Rule 1
    switch (ev.key) {
      case 'c1':
        events.push(...ladder('c1', ev.time, C1_LEADS_S, c1Phrase), toneEvent('c1', ev.time));
        break;
      case 'c2':
        events.push(...ladder('c2', ev.time, C2_LEADS_S, c2Phrase), toneEvent('c2', ev.time));
        break;
      case 'c3': {
        const leads =
          lc.durationS === null
            ? C3_LEADS_S
            : C3_LEADS_S.filter((leadS) => lc.durationS! >= leadS + GUARD_BUFFER_S);
        events.push(
          ...ladder('c3', ev.time, leads, c3Phrase),
          toneEvent('c3', ev.time),
          {
            id: 'c3:filters-on',
            key: 'c3',
            time: new Date(ev.time.getTime() + FILTERS_ON_LAG_S * 1000),
            channel: 'speech',
            prewarn: false,
            phrase: FILTERS_ON_PHRASE,
          },
        );
        break;
      }
      case 'max':
        events.push({
          id: 'max:0',
          key: 'max',
          time: ev.time,
          channel: 'speech',
          prewarn: false,
          phrase: MAX_PHRASE,
        });
        break;
    }
  }
  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
}
