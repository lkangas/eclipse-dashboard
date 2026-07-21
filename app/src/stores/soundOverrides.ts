// User-editable overrides for the sound-warnings feature (direct request:
// a config view, in place of the Timetable panel, listing every
// individual sound event with the ability to disable/re-enable it and
// edit its spoken text). Layered on top of sound/eligibility.ts's fixed,
// computed event list -- this store never invents new events or lead
// times of its own, it only filters/relabels the existing ones.
//
// Persisted to localStorage (unlike SchedulerState's own fired-flags,
// which must never persist, per docs/SOUND-PLAN.md §4.3 -- these are
// genuine user preferences, not session state, so losing a customization
// on every reload would defeat the point of editing it at all).
import { writable } from 'svelte/store';

const STORAGE_KEY = 'eclipse-dashboard:sound-overrides';

export interface SoundOverrides {
  /** ids (sound/eligibility.ts's SoundEvent#id, e.g. "c1:300", "c2:0",
   * "c3:filters-on") the user has turned off. Absence from this set means
   * enabled -- the default, for every event, is on. */
  disabledIds: string[];
  /** id -> replacement spoken text, only meaningful for events that have
   * a phrase at all (tone-only events have nothing to override). */
  phraseOverrides: Record<string, string>;
}

function loadInitial(): SoundOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { disabledIds: [], phraseOverrides: {} };
    const parsed = JSON.parse(raw) as Partial<SoundOverrides>;
    return {
      disabledIds: Array.isArray(parsed.disabledIds) ? parsed.disabledIds : [],
      phraseOverrides:
        parsed.phraseOverrides && typeof parsed.phraseOverrides === 'object' ? parsed.phraseOverrides : {},
    };
  } catch {
    // Corrupt JSON, or storage unavailable (private browsing/quota) --
    // start from defaults rather than throwing during module init.
    return { disabledIds: [], phraseOverrides: {} };
  }
}

export const soundOverrides = writable<SoundOverrides>(loadInitial());

soundOverrides.subscribe((v) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Storage unavailable -- overrides just won't survive a reload; the
    // in-memory store still works for the rest of this session.
  }
});

export function toggleEventEnabled(id: string, enabled: boolean): void {
  soundOverrides.update((v) => ({
    ...v,
    disabledIds: enabled ? v.disabledIds.filter((x) => x !== id) : [...new Set([...v.disabledIds, id])],
  }));
}

/** Set a custom spoken text for `id`, or clear it (revert to the default
 * phrase from sound/phrases.ts) when `text` is null or blank. */
export function setPhraseOverride(id: string, text: string | null): void {
  soundOverrides.update((v) => {
    const phraseOverrides = { ...v.phraseOverrides };
    if (text === null || text.trim() === '') delete phraseOverrides[id];
    else phraseOverrides[id] = text;
    return { ...v, phraseOverrides };
  });
}
