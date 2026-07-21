// Thin, deliberately-untested glue for the sound-warnings feature
// (docs/SOUND-PLAN.md §3.3/§4.2/§5) -- real AudioContext/SpeechSynthesis
// wiring, kept as small as possible (same "keep it thin, untested surface
// stays small" convention this codebase's other real-hardware-facing glue
// already uses -- serial/connection.ts vs. its own pure nmeaFix.ts/
// nmeaSatellites.ts). All the actual decision logic (which event fires
// when, what to say, which voice to prefer) lives in pure, tested modules
// elsewhere (scheduler.ts, eligibility.ts, voices.ts, phrases.ts, tones.ts)
// -- this file just calls the real browser APIs.
import type { ToneSpec } from './tones';
import { preferredVoice, type VoiceInfo } from './voices';

let audioContext: AudioContext | null = null;
let selectedVoice: SpeechSynthesisVoice | null = null;
let armedOscillators: OscillatorNode[] = [];

function ctx(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

/** Resume (or create+resume) the shared AudioContext -- must be called
 * from within a user gesture the first time (browser autoplay policy). */
export async function resumeAudio(): Promise<void> {
  await ctx().resume();
}

/** Play `spec` right now, or `delaySec` from the moment this is called
 * (docs/SOUND-PLAN.md §3.3's arm-ahead case) -- a RELATIVE delay, not an
 * absolute timestamp. Deliberately relative: the caller (soundWarnings.ts)
 * computes `delaySec` against whatever clock is currently driving the app
 * (`effectiveTime`, which is real wall-clock time in live mode but can be
 * an arbitrary simulated instant -- weeks away from `Date.now()` -- in sim
 * mode). An earlier version of this fix took an ABSOLUTE target timestamp
 * and computed the delay against `Date.now()` inside this function --
 * correct for live mode only, and a real regression in sim mode: an
 * event's own Date (e.g. 2026-08-12) compared against the real current
 * date (e.g. 2026-07-21) produced a multi-week "delay," so no sim-mode
 * tone or arm-ahead speech ever actually played. Reverted to a relative
 * delay for that reason.
 *
 * Deliberately `async` and always AWAITS `resume()` before reading
 * `currentTime` -- `currentTime` freezes while the context is `suspended`
 * and does not "catch up" once resumed, it just continues advancing from
 * wherever it was frozen. The previous version read `currentTime`
 * synchronously right after a fire-and-forget `void c.resume()`, so any
 * time the context needed to actually resume from suspension (multi-
 * minute gaps between ladder rungs make this a real risk, not just
 * theoretical), the computed `startAt` was silently anchored to a stale
 * clock reference and the tone played however long resume() took to
 * complete AFTER the intended instant -- this was reported and confirmed
 * as the tone channel's own share of a "sounds come 1-2s late" bug,
 * 2026-07-21. `performance.now()` (monotonic, real elapsed time,
 * unaffected by either Date.now() or this app's own simulated clock)
 * measures how long any such await actually took, and that much is
 * subtracted from `delaySec` before computing `startAt` -- so a delayed
 * resume() eats into the lead time instead of silently vanishing into a
 * stale `currentTime` snapshot. */
export async function playTone(spec: ToneSpec, delaySec = 0): Promise<void> {
  const c = ctx();
  const callTime = performance.now();
  if (c.state !== 'running') {
    await c.resume();
  }
  const elapsedWhileResumingS = (performance.now() - callTime) / 1000;
  const adjustedDelaySec = Math.max(0, delaySec - elapsedWhileResumingS);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = spec.frequencyHz;
  osc.connect(gain);
  gain.connect(c.destination);
  const startAt = c.currentTime + adjustedDelaySec;
  osc.start(startAt);
  osc.stop(startAt + spec.durationS);
  if (adjustedDelaySec > 0) {
    armedOscillators.push(osc);
    osc.addEventListener('ended', () => {
      armedOscillators = armedOscillators.filter((o) => o !== osc);
    });
  }
}

/** Stops every tone scheduled ahead of time via playTone's `delaySec` but
 * not yet played (docs/SOUND-PLAN.md §3.5: re-arming on an observer change
 * must cancel anything scheduled against the old location's contact
 * times). No-op for anything already played or never armed. */
export function cancelArmedTones(): void {
  for (const osc of armedOscillators) {
    try {
      osc.stop();
    } catch {
      // Already stopped/ended -- fine, nothing to cancel.
    }
  }
  armedOscillators = [];
}

/** getVoices() with the async voiceschanged population workaround
 * (docs/SOUND-PLAN.md §6.4) -- resolves once, even on a browser that
 * populates the list asynchronously after the first synchronous call
 * returns empty. */
function loadRawVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    const onChange = () => {
      speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(() => {
      speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(speechSynthesis.getVoices());
    }, 2000);
  });
}

/** Selects a local-only voice (docs/SOUND-PLAN.md §1.5 -- never falls
 * through to an unfiltered default). Returns true if a usable voice was
 * found and selected; false means SpeechSynthesis must be treated as
 * unavailable on this device (the caller should surface degraded mode,
 * §4.1). */
export async function selectLocalVoice(): Promise<boolean> {
  if (!('speechSynthesis' in window)) {
    selectedVoice = null;
    return false;
  }
  const raw = await loadRawVoices();
  const infos: VoiceInfo[] = raw.map((v) => ({ name: v.name, lang: v.lang, localService: v.localService }));
  const preferred = preferredVoice(infos);
  selectedVoice = preferred ? (raw.find((v) => v.name === preferred.name && v.lang === preferred.lang) ?? null) : null;
  return selectedVoice !== null;
}

export function isVoiceAvailable(): boolean {
  return selectedVoice !== null;
}

/** Speak `text` using the selected local voice -- no-op if none was ever
 * selected (never fall through to an unfiltered default voice, §1.5).
 * Cancels any in-flight utterance first: adjacent countdown rungs can be
 * close enough together (as little as 5s, §1.3) that an overlapping
 * utterance is a real risk on a slow engine (§5.9). */
export function speak(text: string): void {
  if (!selectedVoice) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = selectedVoice;
  speechSynthesis.speak(utterance);
}

export function cancelSpeech(): void {
  speechSynthesis.cancel();
}

/** Conservative fallback onset-latency estimate (ms) if a real measurement
 * can't be taken (no voice, error, or the utterance's own `onstart` never
 * fires before the timeout) -- roughly this feature's ORIGINAL assumption
 * before the real number was measured and found much higher on Windows
 * SAPI voices via Chrome (see speakAndMeasureLatency's own comment). */
const FALLBACK_SPEECH_LATENCY_MS = 300;

/** Speaks `text` and resolves with the measured onset latency in ms -- the
 * real elapsed time between calling `speak()` and the utterance's own
 * `onstart` event actually firing. Used once, at enable/test time
 * (stores/soundWarnings.ts's enableOrTestSound), to calibrate how far
 * ahead of a countdown rung's nominal instant `speak()` should be called
 * to compensate for this specific engine/voice's real dispatch latency.
 * §3.3's original design assumed this latency was "tens to a few hundred
 * ms" and therefore "irrelevant" -- live-measured on a real Windows/Chrome
 * session with the "Microsoft David" SAPI voice, it was actually
 * 1.0-1.8 SECONDS, confirmed as the dominant cause of a reported
 * "sounds come 1-2s late" bug, 2026-07-21. Resolves with
 * FALLBACK_SPEECH_LATENCY_MS rather than rejecting if the utterance errors
 * or `onstart` never fires within `timeoutMs` -- a missed measurement
 * should degrade to "no worse than the original assumption," not crash the
 * enable flow. */
export function speakAndMeasureLatency(text: string, timeoutMs = 4000): Promise<number> {
  return new Promise((resolve) => {
    if (!selectedVoice) {
      resolve(FALLBACK_SPEECH_LATENCY_MS);
      return;
    }
    const callTime = performance.now();
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selectedVoice;
    let settled = false;
    const finish = (ms: number) => {
      if (settled) return;
      settled = true;
      resolve(ms);
    };
    utterance.onstart = () => finish(Math.max(0, performance.now() - callTime));
    utterance.onerror = () => finish(FALLBACK_SPEECH_LATENCY_MS);
    setTimeout(() => finish(FALLBACK_SPEECH_LATENCY_MS), timeoutMs);
    speechSynthesis.speak(utterance);
  });
}

let wakeLock: { release: () => Promise<void> } | null = null;

/** Acquire a screen wake lock (docs/SOUND-PLAN.md §5.7) -- a tab that's
 * allowed to actually lock/sleep can silently defeat every other part of
 * this feature at once. Graceful no-op on unsupported browsers
 * (historically inconsistent on iOS Safari) -- there's no fallback for a
 * browser that doesn't have this API, only the field-guidance copy
 * (SoundControl.svelte) asking the user to keep the screen on themselves.
 * The API auto-releases the lock the instant the tab is hidden even
 * briefly, so re-acquire on every return to visible. */
export async function acquireWakeLock(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release: () => Promise<void> }> } };
  if (!nav.wakeLock) return;
  try {
    wakeLock = await nav.wakeLock.request('screen');
  } catch {
    // Denied, or the document isn't visible/focused right now -- nothing
    // more to do; the visibilitychange handler below will retry.
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLock !== null) void acquireWakeLock();
  });
}
