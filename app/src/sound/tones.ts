// Tone envelope spec for the sound-warnings feature (docs/SOUND-PLAN.md
// §2.1/§6) -- deliberately ONE shared shape reused identically for
// C1/C2/C3 for now, per direct instruction (2026-07-21): the plan
// originally sketched three distinct shapes (a rising sweep for C2, a
// faster/falling sweep for C3, an undesigned third for C1), but
// differentiating them is explicit future iteration, not Phase 1 scope --
// "let's iterate on those once we get there."
//
// Plain data, no AudioContext/OscillatorNode dependency -- audioEngine.ts
// (not yet built, gated on the Phase 0 voice/network spike for its
// SpeechSynthesis half, but not for this tone half) is the thin glue that
// actually plays this.

export interface ToneSpec {
  /** Oscillator frequency in Hz -- mid-range, reproducible on cheap
   * laptop/phone speakers (docs/SOUND-PLAN.md §1.1's own frequency
   * reasoning, carried forward even though the three-shape design it
   * was part of is deferred). */
  frequencyHz: number;
  durationS: number;
}

/** The one shared tone shape for C1/C2/C3's at-instant cue. */
export const CONTACT_TONE: ToneSpec = {
  frequencyHz: 700,
  durationS: 0.5,
};
