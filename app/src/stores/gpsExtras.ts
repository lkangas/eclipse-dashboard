// PLAN.md §6 phase 3: the store backing the GPS monitor's cheap
// once-per-epoch panels (VTG, GLL, ZDA, HDG, GNS, RMC-extras) -- sibling
// to gpsSatellites.ts, same "separate from gpsConnection, diagnostic-only,
// gated behind gpsMonitorOpen" reasoning as that module's own header
// comment, just backed by nmeaExtras.ts's simpler latest-wins reducer
// instead of nmeaSatellites.ts's GSV reassembly.
import { writable } from 'svelte/store';
import { parseRichNmeaSentence } from '../serial/nmeaRich';
import { applyExtraSentence, initialExtrasState, type ExtrasState } from '../serial/nmeaExtras';

export const gpsExtras = writable<ExtrasState>(initialExtrasState);

// Module-level mirror of the store's current value, same convention as
// gpsSatellites.ts's own module-level `state`.
let state: ExtrasState = initialExtrasState;

/** Feeds one raw NMEA line through the rich parser, updating the
 * gpsExtras store when it's one of the six types this module owns
 * (VTG/GLL/ZDA/HDG/GNS/RMC) -- a no-op for anything else, including
 * GSV/GSA (gpsSatellites.ts's own concern) or an unrecognized/malformed
 * line. Parses the raw line independently of gpsSatellites.ts's own
 * applyRichNmeaLine rather than sharing one parse call -- keeps the two
 * modules fully decoupled (neither needs to know the other exists), at
 * the cost of a second cheap parse of the same line; connection.ts calls
 * both, gated the same way, alongside each other. */
export function applyExtraNmeaLine(rawLine: string): void {
  const sentence = parseRichNmeaSentence(rawLine);
  if (!sentence) return;
  if (sentence.type === 'GSV' || sentence.type === 'GSA') return;
  state = applyExtraSentence(state, sentence);
  gpsExtras.set(state);
}

/** Resets to empty -- intended for connection.ts to call on disconnect/
 * fresh connect, same convention as gpsSatellites.ts's own
 * resetGpsSatellites(). */
export function resetGpsExtras(): void {
  state = initialExtrasState;
  gpsExtras.set(state);
}
