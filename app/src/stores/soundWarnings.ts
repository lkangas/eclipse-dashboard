// Reactive integration layer for the sound-warnings feature
// (docs/SOUND-PLAN.md §3.3/§3.5/§4.2) -- wires effectiveTime and
// soundEligibleEvents(localCircumstances) into sound/scheduler.ts's tick()
// and sound/audioEngine.ts's real playback calls. Self-subscribes once at
// module load (same always-on singleton convention as stores/now.ts and
// stores/clock.ts -- there's no template binding to drive a subscription
// from here, so the module keeps effectiveTime/localCircumstances "hot"
// itself for the whole page lifetime).
import { derived, writable, get } from 'svelte/store';
import { effectiveTime } from './clock';
import { localCircumstances } from './localCircumstances';
import { soundOverrides } from './soundOverrides';
import { soundEligibleEvents, type SoundEvent } from '../sound/eligibility';
import { initialSchedulerState, tick, type SchedulerState } from '../sound/scheduler';
import { CONTACT_TONE } from '../sound/tones';
import {
  playTone,
  cancelArmedTones,
  speak,
  cancelSpeech,
  resumeAudio,
  selectLocalVoice,
  speakAndMeasureLatency,
  acquireWakeLock,
} from '../sound/audioEngine';

export type SoundStatus = 'disabled' | 'full' | 'degraded';

/** Has the user completed the enable/test gesture at least once this page
 * load? AudioContext starts suspended and no browser lets this app skip
 * that regardless of any remembered preference (§4.1) -- always false on
 * a fresh load. */
export const soundEnabled = writable(false);
/** 'disabled' until enableSoundWarnings() resolves; then 'full' or
 * 'degraded' depending on whether a local voice was found (§4.1/§5.2). */
export const soundStatus = writable<SoundStatus>('disabled');
/** Master mute (§4.3) -- Phase 1 scope is just this one flag, no category
 * toggles/volume/persistence yet (§6). */
export const soundMuted = writable(false);

// Once the reducer's lookahead shows a tone-channel event within this many
// seconds, schedule it precisely against the audio clock rather than
// waiting for the tick that crosses it (§3.3).
const ARM_LEAD_S = 3;
// "Forward with a plausibly-small delta" (§3.3) -- matches the ordinary
// 1Hz live tick cadence; anything bigger is a sim jump and should use the
// same-tick fire-now fallback instead of arm-ahead.
const SMALL_STEP_MS = 2000;
// Clamp for the measured SpeechSynthesis onset latency (speechLeadS below)
// -- bounds a single bad/erratic measurement from making countdown rungs
// fire implausibly early. Deliberately kept below 5s: every countdown
// ladder's tightest consecutive-rung gap (§2.1) is 5 seconds (e.g. C1's
// "10 seconds"/"5 seconds"), so firing each rung independently up to this
// much early can never reorder two rungs relative to each other or shrink
// the gap between them to something an utterance can't finish speaking in.
const MAX_SPEECH_LEAD_S = 3;
// A single measurement of a real, variable-latency engine is noisy --
// live-measured call-to-call variance on one Windows/Chrome session
// ranged roughly 1.0-1.8s for the same voice. Erring toward firing a rung
// too EARLY is the safer direction for this feature's two safety-adjacent
// speech cues ("Fifteen, filters off!" firing early means more lead time
// before totality; "Filters on!" firing early means less time spent
// looking at the reappearing photosphere without a filter) -- so a flat
// margin is added on top of the single real measurement, biasing toward
// over- rather than under-compensating, without adding extra utterances
// to §4.2's documented self-test sequence just to average multiple
// samples.
const SPEECH_LEAD_SAFETY_MARGIN_S = 0.3;

let schedulerState: SchedulerState | null = null;
// Tone ids already armed via playTone's delaySec -- distinct from
// SchedulerState's own `fired` set, which only tracks the reducer's
// crossing detection, not whether audioEngine has already scheduled the
// physical play for this particular id.
let armedIds = new Set<string>();
// Speech-channel ids already fired EARLY to compensate for real-world
// speak() onset latency (see speechLeadS below) -- the speech-channel
// analog of armedIds, so the ordinary toFire loop doesn't re-speak a rung
// that was already spoken ahead of its nominal instant.
let spokenIds = new Set<string>();
// Measured real onset latency (seconds) between calling speak() and the
// utterance actually becoming audible, for the currently-selected voice --
// 0 until enableOrTestSound() measures it (matching the ORIGINAL, now-
// known-wrong assumption that this latency was negligible, as a safe no-
// compensation default for the brief window before the first measurement
// lands). §3.3 assumed speech's own onset latency was "tens to a few
// hundred ms" and therefore irrelevant; live-measured on a real Windows/
// Chrome session with a "Microsoft David" SAPI voice, it was actually
// 1.0-1.8 SECONDS -- confirmed as the dominant cause of a reported "sounds
// come 1-2s late" bug, 2026-07-21. Rather than hardcode a guessed
// constant (voice/OS/engine dependent), this is measured fresh each
// session using the SAME confirmation utterance enableOrTestSound() was
// already speaking, timing its own `onstart` event.
let speechLeadS = 0;
// Value-based marker for "did the eligible-events list itself actually
// change" (§3.5) -- NOT array-reference identity. localCircumstances (and
// therefore soundEligibleEvents' output) recomputes on every `observer`
// update, and setObserver is called roughly once a second, UNCONDITIONALLY,
// for the entire duration of a live GPS-connected session (serial/
// connection.ts's flushFix, throttled to ~1/s but never skipped merely
// because the fix didn't move) -- so a fresh array is a near-certainty on
// almost every tick while GPS is connected, not just on a real relocation.
// Comparing by value (rounded to the nearest second -- ticks only ever run
// at ~1Hz, so ordinary GPS-fix jitter of a few meters, which shifts a
// contact time by a couple of milliseconds, can't affect *when* anything
// fires anyway) means the common case -- a stationary or slow-moving GPS
// observer -- correctly stops re-arming once the derived event times
// settle, instead of re-arming every single tick for the entire session.
let lastEventsKey: string | null = null;

function eventsKey(events: SoundEvent[]): string {
  return events.map((e) => `${e.id}:${Math.round(e.time.getTime() / 1000)}`).join('|');
}

function fireAheadIfDue(events: SoundEvent[], curMs: number, prevMs: number): void {
  const smallForward = curMs > prevMs && curMs - prevMs <= SMALL_STEP_MS;
  if (!smallForward) return;
  for (const ev of events) {
    if (schedulerState!.fired.has(ev.id)) continue;
    const deltaS = (ev.time.getTime() - curMs) / 1000;
    if (deltaS <= 0) continue;
    if (ev.channel === 'tone') {
      if (armedIds.has(ev.id)) continue;
      if (deltaS <= ARM_LEAD_S) {
        void playTone(CONTACT_TONE, deltaS);
        armedIds.add(ev.id);
      }
    } else {
      // Speech has no audio-clock scheduling primitive to arm ahead of
      // time with -- the only available compensation is to call speak()
      // itself early, by the measured onset-latency margin, so the
      // utterance becomes audible close to the nominal instant instead of
      // speechLeadS seconds after it.
      if (spokenIds.has(ev.id) || speechLeadS <= 0) continue;
      if (deltaS <= speechLeadS) {
        if (ev.phrase) speak(ev.phrase);
        spokenIds.add(ev.id);
      }
    }
  }
}

function onTick(curMs: number, events: SoundEvent[]): void {
  if (!get(soundEnabled)) return; // AudioContext never unlocked yet -- nothing to do.

  const key = eventsKey(events);
  if (schedulerState === null) {
    // First tick ever (or first since sound was enabled) -- nothing to
    // preserve, anchor fresh at the current instant per
    // initialSchedulerState's own contract.
    schedulerState = initialSchedulerState(curMs);
    armedIds = new Set();
    spokenIds = new Set();
    lastEventsKey = key;
  } else if (key !== lastEventsKey) {
    lastEventsKey = key;
    // Re-arm on a genuine observer change (§3.5): clear fired-state and
    // cancel anything already scheduled against the old location's contact
    // times, but deliberately do NOT bump lastEffectiveMs to curMs here --
    // it must stay at its previous value so the tick() call just below
    // still gets to check the (curMs - prevMs] window against the NEW
    // event list. Resetting lastEffectiveMs to curMs on every re-arm would
    // make tick()'s own crossing check (curMs > state.lastEffectiveMs) false
    // on that exact tick every single time -- a no-op collapse to a zero-
    // width window -- which, combined with how often this branch runs
    // during a live GPS session, would silently and permanently swallow
    // anything due to cross right around a re-arm, with no visible sign
    // anything went wrong. Any event whose time already fell at or before
    // the old lastEffectiveMs is still correctly caught by scheduler.ts's
    // own multi-crossing collapse rule, exactly like an ordinary sim jump.
    schedulerState = { lastEffectiveMs: schedulerState.lastEffectiveMs, fired: new Set() };
    armedIds = new Set();
    spokenIds = new Set();
    cancelArmedTones();
  }
  const prevMs = schedulerState!.lastEffectiveMs;
  const muted = get(soundMuted);
  if (!muted) fireAheadIfDue(events, curMs, prevMs);

  const result = tick(schedulerState!, curMs, events);
  schedulerState = result.state;
  if (muted) return;

  for (const ev of result.toFire as SoundEvent[]) {
    if (ev.channel === 'speech') {
      // Already spoken early to compensate for onset latency (above) --
      // don't repeat. Only unspoken (speechLeadS is 0, or a sim jump
      // skipped past the compensation window entirely) fires here.
      if (!spokenIds.has(ev.id) && ev.phrase) speak(ev.phrase);
      spokenIds.delete(ev.id);
    } else {
      // Already armed and playing from the precise audio-clock schedule
      // above -- don't replay. Only unarmed (a sim jump landed inside the
      // arm window or skipped past it entirely, §3.3's fallback) fires
      // here, immediately, with no forward scheduling.
      if (!armedIds.has(ev.id)) void playTone(CONTACT_TONE);
      armedIds.delete(ev.id);
    }
  }
}

// Recomputed whenever localCircumstances OR soundOverrides changes --
// localCircumstances changes in practice roughly once a second for the
// whole duration of a live GPS-connected session (see lastEventsKey's own
// comment above). onTick deliberately does NOT rely on this array's
// reference identity to decide whether a real re-arm is warranted -- only
// on eventsKey()'s value comparison of ids+times, which disabling/
// re-enabling an event changes (it's added to or removed from the array
// entirely), correctly triggering the same full re-arm path as an
// observer move (cancels any already-armed tone for a just-disabled id,
// clears fired-state). A pure phrase-TEXT edit does NOT change eventsKey
// (same id, same time, only the string differs) and doesn't need to --
// it's not gated by any scheduler state, `speak(ev.phrase)` always reads
// whatever `ev.phrase` this array holds at the moment it actually fires.
const eligibleEvents = derived([localCircumstances, soundOverrides], ([$lc, $overrides]) => {
  const base = soundEligibleEvents($lc);
  const enabled = base.filter((ev) => !$overrides.disabledIds.includes(ev.id));
  return enabled.map((ev) => {
    const override = $overrides.phraseOverrides[ev.id];
    // Only speech events have a phrase to override in the first place --
    // a tone-only event's `phrase` stays `null` regardless.
    return override !== undefined && ev.phrase !== null ? { ...ev, phrase: override } : ev;
  });
});

derived([effectiveTime, eligibleEvents], ([$t, $events]) => ({ t: $t, events: $events })).subscribe(
  ({ t, events }) => onTick(t.getTime(), events),
);

/** The enable gesture (§4.2) and the persistent, re-runnable "Test Sound"
 * action are the same thing by design -- both run this exact sequence:
 * resume the audio context, play the three real contact tones back-to-
 * back, then attempt to select a local voice and speak a confirmation (or
 * flag degraded mode if none is found). Must be called from directly
 * inside a user gesture (browser autoplay policy, §5.4). The confirmation
 * utterance doubles as this session's speechLeadS calibration -- see
 * speechLeadS's own comment above for why this measurement exists at all. */
export async function enableOrTestSound(): Promise<void> {
  await resumeAudio();
  void acquireWakeLock(); // §5.7 -- best-effort, doesn't block the audio self-test below.
  void playTone(CONTACT_TONE, 0);
  void playTone(CONTACT_TONE, CONTACT_TONE.durationS);
  void playTone(CONTACT_TONE, CONTACT_TONE.durationS * 2);
  const hasVoice = await selectLocalVoice();
  soundStatus.set(hasVoice ? 'full' : 'degraded');
  soundEnabled.set(true);
  if (hasVoice) {
    const measuredMs = await speakAndMeasureLatency('Sound warnings enabled.');
    speechLeadS = Math.min(MAX_SPEECH_LEAD_S, Math.max(0, measuredMs / 1000) + SPEECH_LEAD_SAFETY_MARGIN_S);
  } else {
    speechLeadS = 0;
  }
}

/** Master mute toggle (§4.3/§4.1's "Muted" state) -- muting cancels
 * anything already armed ahead of time via the audio clock (a tone
 * scheduled in the last few seconds before the mute click would otherwise
 * still physically play regardless of the flag) and any in-flight speech,
 * not just future events. */
export function setSoundMuted(muted: boolean): void {
  soundMuted.set(muted);
  if (muted) {
    cancelArmedTones();
    armedIds.clear();
    spokenIds.clear();
    cancelSpeech();
  }
}
