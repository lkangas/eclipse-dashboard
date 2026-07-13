// PLAN.md §6: the "current simulated instant" plus mode. simTimeMs is a
// real UTC epoch (ms) -- only meaningful in 'sim' mode; in 'live' mode the
// effective instant is always the real live clock (see effectiveTime
// below), continuously, not a frozen snapshot.
import { derived, writable } from 'svelte/store';
import { now } from './now';
import { getGpsClockOffsetMs } from '../serial/connection';

export type ClockMode = 'live' | 'sim';
/** Which window TimeBar's track currently shows -- 'in' is a close-up
 * around totality, 'default' the whole event (partial phase through
 * sunset) with margin, 'out' a wide fixed window (see TimeBar.svelte).
 * Replaces the old arcsinh warp-curve levels: the track is always linear
 * now, only the visible domain changes. */
export type ZoomLevel = 'in' | 'default' | 'out';

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
  zoomLevel: 'default',
});

// The instant every time-driven view (map shadow marker, time slider
// cursor, ...) should actually display. In 'live' mode this is
// disciplined to a connected GPS's own UTC when available (PLAN.md §6)
// -- offset-corrected system time rather than the GPS's own (sparser,
// throttled) timestamp directly, so it still ticks smoothly every
// second between fixes instead of jumping only when a new NMEA sentence
// arrives. getGpsClockOffsetMs() is a plain function call, not a store
// subscription, so a fast (10Hz) receiver disciplining the offset in the
// background doesn't add any recomputation beyond this derived store's
// existing 1Hz tick from `now`.
export const effectiveTime = derived([clock, now], ([$clock, $now]) => {
  if ($clock.mode !== 'live') return new Date($clock.simTimeMs);
  const offsetMs = getGpsClockOffsetMs();
  return offsetMs === null ? $now : new Date($now.getTime() + offsetMs);
});
