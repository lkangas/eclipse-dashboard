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
import {
  applyGsaSentence,
  applyGsvSentence,
  initialSatellitesState,
  type SatellitesState,
} from '../serial/nmeaSatellites';

export const gpsSatellites = writable<SatellitesState>(initialSatellitesState);

// Module-level mirror of the store's current value, same convention as
// connection.ts's own latestFix -- lets applyRichNmeaLine below fold
// state without a get()-per-call.
let state: SatellitesState = initialSatellitesState;

/**
 * Feeds one raw NMEA line through the rich (GSV/GSA) parser + reducer,
 * updating the gpsSatellites store on a completed constellation group or
 * a fresh full-GSA arrival. No-op if the line isn't a recognized rich
 * sentence. Called from connection.ts's applyLine(), gated behind
 * monitorActive (a gpsMonitorOpen-derived module boolean -- see
 * docs/GPS-MONITOR-PLAN.md §3 for the mechanism).
 */
export function applyRichNmeaLine(rawLine: string): void {
  const sentence = parseRichNmeaSentence(rawLine);
  if (!sentence) return;
  // This module only cares about GSV (reassembled across a multi-sentence
  // run, see applyGsvSentence) and full GSA (already complete on its own,
  // see applyGsaSentence) -- parseRichNmeaSentence can now also return
  // VTG/GLL/ZDA/HDG/GNS/RMC-extras (PLAN.md §6 phase 3, gpsExtras.ts's own
  // concern), so this can no longer assume "anything not GSV is GSA".
  const prevState = state;
  if (sentence.type === 'GSV') {
    state = applyGsvSentence(state, sentence, Date.now());
  } else if (sentence.type === 'GSA') {
    state = applyGsaSentence(state, sentence, Date.now());
  } else {
    return;
  }
  // Publish only when what's actually DISPLAYED changed -- a GSV group
  // just completed (constellations got a fresh object) or a GSA arrived
  // (gsaByKey did) -- matching this function's own doc comment above
  // ("on a completed constellation group or a fresh full-GSA arrival"),
  // which the code had silently drifted away from: it used to call
  // gpsSatellites.set(state) unconditionally on EVERY GSV sentence,
  // including every still-assembling intermediate message, not just the
  // one that completes a group. applyGsvSentence's own incomplete branch
  // spreads the old state (`{ ...state, assemblies: {...} }`), so
  // `constellations`/`gsaByKey` keep their EXACT prior object reference
  // in that case -- only becoming a new reference on a real completion --
  // which is exactly what these two reference checks detect, with no
  // extra state or timer needed. Bug report: a fast multi-constellation
  // receiver can emit ~10-14 GSV sentences per epoch (2-4 messages per
  // constellation), but only ~1 of those per constellation is a real
  // completion -- publishing on every intermediate message forced
  // SatelliteSkyPlot.svelte/SnrBarChart.svelte (both SVG, cost scaling
  // with satellite count) to fully recompute and repaint up to ~10x more
  // often than the displayed data actually changed, enough to visibly
  // stall the main thread (the GPS monitor's own clock freezing, click
  // handlers not responding) under a fast enough receiver.
  if (state.constellations !== prevState.constellations || state.gsaByKey !== prevState.gsaByKey) {
    gpsSatellites.set(state);
  }
}

/** Resets to empty -- called from connection.ts on disconnect/fresh
 * connect, same "reset on fresh connect" convention as gpsConnection's own
 * recentLines/fixRateHz fields. */
export function resetGpsSatellites(): void {
  state = initialSatellitesState;
  gpsSatellites.set(state);
}
