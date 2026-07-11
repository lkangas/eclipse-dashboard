// PLAN.md §6: the "current simulated instant" plus mode. simTimeMs is a
// real UTC epoch (ms) -- only meaningful in 'sim' mode; in 'live' mode the
// effective instant is always the real live clock (see effectiveTime
// below), continuously, not a frozen snapshot.
import { derived, writable } from 'svelte/store';
import { now } from './now';

export type ClockMode = 'live' | 'sim';
export type CurveLevel = 'real' | 'stretch' | 'stretchplus';

export interface ClockState {
  mode: ClockMode;
  simTimeMs: number;
  playing: boolean;
  curveLevel: CurveLevel;
}

export const clock = writable<ClockState>({
  mode: 'live',
  simTimeMs: Date.now(),
  playing: false,
  curveLevel: 'real',
});

// The instant every time-driven view (map shadow marker, time slider
// cursor, ...) should actually display.
export const effectiveTime = derived(
  [clock, now],
  ([$clock, $now]) => ($clock.mode === 'live' ? $now : new Date($clock.simTimeMs)),
);
