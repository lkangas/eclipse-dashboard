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

/** Play `spec` right now, or `delaySec` from now for the arm-ahead case
 * (docs/SOUND-PLAN.md §3.3) -- `audioContext.currentTime + delaySec` owns
 * the exact playback moment, not the caller's own timer. Defensive
 * `resume()` before every play (some browsers, Safari particularly, can
 * auto-suspend after a period of silence even after an initial resume()). */
export function playTone(spec: ToneSpec, delaySec = 0): void {
  const c = ctx();
  void c.resume();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = spec.frequencyHz;
  osc.connect(gain);
  gain.connect(c.destination);
  const startAt = c.currentTime + Math.max(0, delaySec);
  osc.start(startAt);
  osc.stop(startAt + spec.durationS);
  if (delaySec > 0) {
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
