// PLAN.md §6 phase 3: the cheap once-per-epoch panels -- VTG, GLL, ZDA,
// HDG, GNS, and the RMC-extras fields nmea.ts's own minimal RmcSentence
// doesn't carry. Unlike nmeaSatellites.ts's GSV reassembly, none of these
// need cross-sentence bookkeeping: each is a single, complete sentence on
// its own, so the reducer is just "latest sentence of each type wins" --
// no reassembly, no staleness window, no cross-referencing.
import type { GllSentence, GnsSentence, HdgSentence, RmcExtrasSentence, VtgSentence, ZdaSentence } from './nmeaRich';

export interface ExtrasState {
  vtg: VtgSentence | null;
  gll: GllSentence | null;
  zda: ZdaSentence | null;
  hdg: HdgSentence | null;
  gns: GnsSentence | null;
  rmcExtras: RmcExtrasSentence | null;
}

export const initialExtrasState: ExtrasState = {
  vtg: null,
  gll: null,
  zda: null,
  hdg: null,
  gns: null,
  rmcExtras: null,
};

export type ExtraSentence = VtgSentence | GllSentence | ZdaSentence | HdgSentence | GnsSentence | RmcExtrasSentence;

/** Folds one already-parsed extra sentence into state -- the latest
 * sentence of a given type simply replaces whatever was there before, the
 * same "freeze at last-known, never guess" philosophy as the rest of this
 * app's reducers, just without any multi-sentence assembly step since
 * none of these types need one. */
export function applyExtraSentence(state: ExtrasState, sentence: ExtraSentence): ExtrasState {
  switch (sentence.type) {
    case 'VTG':
      return { ...state, vtg: sentence };
    case 'GLL':
      return { ...state, gll: sentence };
    case 'ZDA':
      return { ...state, zda: sentence };
    case 'HDG':
      return { ...state, hdg: sentence };
    case 'GNS':
      return { ...state, gns: sentence };
    case 'RMC':
      return { ...state, rmcExtras: sentence };
  }
}
