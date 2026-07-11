// PLAN.md §6: the "current simulated instant" plus mode.
//
// STUB: simTimeSec is seconds-since-midnight local (CEST), matching the
// design/layout-v3-fullscreen.html mock's stub contact-time table. This
// will be revisited once the time slider is wired to real contact times
// (an actual UT instant) instead of the mock's hardcoded T.c1..c4.
import { writable } from 'svelte/store';

export type ClockMode = 'live' | 'sim';
export type CurveLevel = 'real' | 'stretch' | 'stretchplus';

export interface ClockState {
  mode: ClockMode;
  simTimeSec: number;
  playing: boolean;
  curveLevel: CurveLevel;
}

// Matches the mock's stub Zaragoza-reference contact times (seconds since
// midnight CEST) and its initial simTime (T.c2 - 41).
export const STUB_CONTACTS = { c1: 70500, c2: 73744, max: 73784, c3: 73828, c4: 76920 };

export const clock = writable<ClockState>({
  mode: 'live',
  simTimeSec: STUB_CONTACTS.c2 - 41,
  playing: false,
  curveLevel: 'real',
});
