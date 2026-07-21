// Pure local-voice filter/preference predicate (docs/SOUND-PLAN.md §1.5/
// §5.1) -- the non-negotiable guardrail this whole design depends on:
// hard-filter to genuinely-offline voices, never fall through to an
// unfiltered default that might silently pick a network-backed one (a
// real, specific Chrome/Edge risk -- `speechSynthesis.getVoices()` mixes
// `localService: true` and `localService: false` entries in the same
// list, with nothing in a naive `new SpeechSynthesisUtterance(text)` call
// stopping the browser from picking a network voice by default).
export interface VoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
}

/** Every genuinely-local voice, English-tagged ones first (this app's own
 * countdown phrases are English) -- order is preference order, not
 * filesystem/array order. Empty result means SpeechSynthesis must be
 * treated as entirely unavailable on this device (docs/SOUND-PLAN.md
 * §1.5) -- never fall through to an unfiltered voice. */
export function localVoices(voices: VoiceInfo[]): VoiceInfo[] {
  return voices
    .filter((v) => v.localService)
    .slice()
    .sort((a, b) => {
      const aEn = a.lang.toLowerCase().startsWith('en') ? 0 : 1;
      const bEn = b.lang.toLowerCase().startsWith('en') ? 0 : 1;
      return aEn - bEn;
    });
}

/** The single voice to actually use, or null if none survives the filter
 * -- callers must treat null as "SpeechSynthesis unavailable", not retry
 * with an unfiltered voice. */
export function preferredVoice(voices: VoiceInfo[]): VoiceInfo | null {
  const filtered = localVoices(voices);
  return filtered.length > 0 ? filtered[0] : null;
}
