// PLAN.md §7: the store backing the GPS monitor's per-constellation
// satellite panels (sky-plot, SNR bars, later GSA cross-referencing) --
// deliberately separate from connection.ts's gpsConnection store (see
// that section's own reasoning: mixing a diagnostic-only satellite blob
// into the product-critical fix/observer interface would bloat something
// TopBar/GpsRibbon read for real, for data nothing outside the monitor
// panel needs).
//
// Unlike connection.ts, this module has NO navigator.serial dependency --
// it's pure raw-line-in, store-out plumbing over nmeaRich.ts's parser and
// nmeaSatellites.ts's reducer -- so unlike connection.ts, it CAN and
// SHOULD be unit tested (see that file's own "keep it thin, untested
// surface stays small" comment for why *it* isn't).
import { writable } from 'svelte/store';
import { parseRichNmeaSentence } from '../serial/nmeaRich';
import { applyGsvSentence, initialSatellitesState, type SatellitesState } from '../serial/nmeaSatellites';

export const gpsSatellites = writable<SatellitesState>(initialSatellitesState);

// Module-level mirror of the store's current value, same convention as
// connection.ts's own latestFix -- lets applyRichNmeaLine below fold
// state without a get()-per-call.
let state: SatellitesState = initialSatellitesState;

/**
 * Feeds one raw NMEA line through the rich (GSV) parser + reducer,
 * updating the gpsSatellites store on a completed constellation group.
 * No-op if the line isn't a recognized rich sentence.
 *
 * NOT CALLED FROM ANYWHERE YET. This is intentionally inert until
 * connection.ts's applyLine() is wired to call it behind a
 * gpsMonitorOpen-derived gate -- deferred to a separate follow-up (see
 * docs/GPS-MONITOR-PLAN.md §3 for the exact mechanism: a
 * gpsMonitorOpen.subscribe()-derived module boolean, checked cheaply
 * before doing any of this per-line work). Not wired in this change
 * because connection.ts is being actively edited elsewhere for an
 * unrelated reconnect-bug fix right now.
 */
export function applyRichNmeaLine(rawLine: string): void {
  const sentence = parseRichNmeaSentence(rawLine);
  // nmeaRich.ts's parser now also recognizes full GSA (PLAN.md §6 phase
  // 2) -- this reducer is still GSV-only (the GSA -> usedInFix
  // cross-reference is a later phase, see nmeaSatellites.ts's own header
  // comment), so a non-GSV sentence is a no-op here rather than being fed
  // into a reducer that doesn't know how to read it.
  if (!sentence || sentence.type !== 'GSV') return;
  state = applyGsvSentence(state, sentence, Date.now());
  gpsSatellites.set(state);
}

/** Resets to empty -- intended for connection.ts to call on disconnect/
 * fresh connect, same "reset on fresh connect" convention as
 * gpsConnection's own recentLines/fixRateHz fields. Not called from
 * anywhere yet, same deferred-wiring reasoning as above. */
export function resetGpsSatellites(): void {
  state = initialSatellitesState;
  gpsSatellites.set(state);
}
