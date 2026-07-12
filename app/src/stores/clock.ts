// PLAN.md §6: the "current simulated instant" plus mode. simTimeMs is a
// real UTC epoch (ms) -- only meaningful in 'sim' mode; in 'live' mode the
// effective instant is always the real live clock (see effectiveTime
// below), continuously, not a frozen snapshot.
import { derived, writable } from 'svelte/store';
import { now } from './now';

export type ClockMode = 'live' | 'sim';
/** Which fixed time window TimeBar's track currently shows -- 'in' is a
 * close-up around Max, 'out' a wide fixed window (see TimeBar.svelte).
 * Replaces the old arcsinh warp-curve levels: the track is always linear
 * now, only the visible domain changes. */
export type ZoomLevel = 'in' | 'out';

export interface ClockState {
  mode: ClockMode;
  simTimeMs: number;
  playing: boolean;
  zoomLevel: ZoomLevel;
}

export const clock = writable<ClockState>({
  mode: 'live',
  simTimeMs: Date.now(),
  playing: false,
  zoomLevel: 'out',
});

// The instant every time-driven view (map shadow marker, time slider
// cursor, ...) should actually display.
export const effectiveTime = derived(
  [clock, now],
  ([$clock, $now]) => ($clock.mode === 'live' ? $now : new Date($clock.simTimeMs)),
);
