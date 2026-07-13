// PLAN.md §5: reassembles GSV's multi-sentence-per-epoch satellite lists
// into one list per constellation. Pure reducer (old state + one parsed
// sentence -> new state), same shape as nmeaFix.ts.
//
// Key design fact: NMEA arrives over a serial byte stream, not a
// packetized/routed transport -- so sentences CANNOT arrive out of order
// relative to each other. The only realistic failure mode is a DROPPED
// line (buffer overrun, or a corrupted line rejected by checksum
// upstream), never reordering. This means the reassembly logic only needs
// to handle gaps, not reordering -- a message that's simply missing just
// leaves that one epoch's group unpublished (frozen at the last complete
// group), it never needs resequencing logic.
import type { GsvSentence } from './nmeaRich';

export interface SatelliteInView {
  prn: number;
  elevationDeg: number | null;
  azimuthDeg: number | null;
  snrDb: number | null;
}

export interface ConstellationSatellites {
  key: string;
  talkerId: string;
  signalId: string | null;
  satellites: SatelliteInView[];
}

/** The one place the (talkerId, signalId) -> lookup key is derived, so
 * this reducer and any future GSA cross-referencing (a later phase) never
 * disagree on how to key the same constellation. */
export function satelliteGroupKey(talkerId: string, signalId: string | null): string {
  return `${talkerId}:${signalId ?? ''}`;
}

interface GsvAssembly {
  totalMsgs: number;
  slots: (SatelliteInView[] | undefined)[]; // index 0..totalMsgs-1, undefined = not yet seen this epoch
  firstSlotAtMs: number; // wall-clock time this assembly was started (see STALE_ASSEMBLY_MS below)
}

export interface SatellitesState {
  assemblies: Record<string, GsvAssembly>; // in-progress, not yet complete
  constellations: Record<string, ConstellationSatellites>; // last COMPLETE group per key
}

export const initialSatellitesState: SatellitesState = { assemblies: {}, constellations: {} };

// An assembly that's sat incomplete for longer than this has necessarily
// spanned into a later epoch -- a real GSV run for one constellation is
// always transmitted together within a single epoch's sentence burst (see
// this module's own comment above on serial-stream ordering guarantees),
// so no realistic single-epoch gap should ever approach this. Matches
// GpsMonitorPanel.svelte's own STALE_MS constant (same value, same
// reasoning, applied there to Hz-readout staleness detection instead).
const STALE_ASSEMBLY_MS = 3000;

export function applyGsvSentence(
  state: SatellitesState,
  sentence: GsvSentence,
  nowMs: number,
): SatellitesState {
  // Defensive guard: nmeaRich.ts's parser should already reject these
  // before they reach here -- this is defense in depth, not the primary
  // guard, so an in-progress assembly never gets corrupted by a
  // malformed sentence slipping through some future change upstream.
  if (sentence.totalMsgs < 1 || sentence.msgNum < 1 || sentence.msgNum > sentence.totalMsgs) {
    return state;
  }

  const key = satelliteGroupKey(sentence.talkerId, sentence.signalId);
  const existing = state.assemblies[key];

  // A new epoch's run starts fresh -- msgNum 1, no in-progress assembly
  // yet, a receiver changing its satellite count mid-run (totalMsgs
  // disagrees with what's already buffered), or the existing assembly
  // having sat incomplete for longer than a single epoch could plausibly
  // take (STALE_ASSEMBLY_MS) -- that last case catches a constellation's
  // own msgNum===1 sentence being dropped in two or more consecutive
  // epochs, which would otherwise let genuinely different epochs' slots
  // get spliced into one "complete" published list. Any incomplete
  // assembly already sitting there is stale, not "better than nothing":
  // same freeze-last-known-state philosophy as nmeaFix.ts, applied to
  // in-progress data instead of published data -- an abandoned partial
  // epoch is actively misleading, so it's discarded rather than kept.
  const startFresh =
    sentence.msgNum === 1 ||
    !existing ||
    existing.totalMsgs !== sentence.totalMsgs ||
    nowMs - existing.firstSlotAtMs > STALE_ASSEMBLY_MS;
  const assembly: GsvAssembly = startFresh
    ? // NOT `new Array(n)` -- that produces a sparse array of holes, and
      // Array.prototype.every() SKIPS holes (vacuously "passes" them),
      // which would make an all-holes-but-one array look complete below.
      // .fill(undefined) makes every slot a real, explicit `undefined`.
      { totalMsgs: sentence.totalMsgs, slots: new Array(sentence.totalMsgs).fill(undefined), firstSlotAtMs: nowMs }
    : { totalMsgs: existing.totalMsgs, slots: existing.slots.slice(), firstSlotAtMs: existing.firstSlotAtMs };

  assembly.slots[sentence.msgNum - 1] = sentence.satellites;

  const isComplete = assembly.slots.length > 0 && assembly.slots.every((slot) => slot !== undefined);

  if (!isComplete) {
    return {
      ...state,
      assemblies: { ...state.assemblies, [key]: assembly },
    };
  }

  // Complete: flatten slots in msgNum order into one published list, and
  // drop the in-progress buffer -- a future msgNum===1 starts fresh.
  const satellites = assembly.slots.flatMap((slot) => slot ?? []);
  const constellation: ConstellationSatellites = {
    key,
    talkerId: sentence.talkerId,
    signalId: sentence.signalId,
    satellites,
  };

  const nextAssemblies = { ...state.assemblies };
  delete nextAssemblies[key];

  return {
    assemblies: nextAssemblies,
    constellations: { ...state.constellations, [key]: constellation },
  };
}
