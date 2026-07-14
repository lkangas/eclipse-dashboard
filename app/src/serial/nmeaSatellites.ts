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
import type { FullGsaSentence, GsvSentence } from './nmeaRich';
import { describeConstellation, describeSystemId } from './monitor';

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

/** A single constellation's latest full-GSA sentence -- PLAN.md §6 phase
 * 2. Stored independently of ConstellationSatellites/GsvAssembly (a
 * separate, GSV-reassembly-shaped data source arriving on its own
 * schedule) rather than merged into the GSV reducer's own state, so the
 * two independently-arriving sentence types never need to be kept in
 * lockstep inside this reducer -- see findMatchingGsa()/withUsedInFix()
 * below for the pure join that combines them on demand instead. */
export interface GsaInfo {
  key: string; // `${talkerId}:${systemId ?? ''}` -- see gsaKey() below
  talkerId: string;
  systemId: string | null;
  fixType: number;
  usedPrns: number[];
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
  // A purely STRUCTURAL fact about this sentence -- true whenever
  // talkerId==='GN' and systemId===null, regardless of whether an actual
  // key collision has happened yet. That shape is inherently ambiguous:
  // a shared 'GN' talker with no System ID gives this app no way to tell
  // WHICH physical constellation the sentence belongs to (see gsaKey()'s
  // own comment and applyGsaSentence() below for what this means for
  // upserts). Any GSA matching this shape gets flagged, not just the
  // second one to arrive under a given key.
  possiblyMixed: boolean;
}

/** The one place the (talkerId, systemId) -> lookup key is derived for
 * GSA info, same "derive it once" spirit as satelliteGroupKey() above --
 * NOT the same key as satelliteGroupKey (GSA has no signalId of its own),
 * so this is deliberately a separate function rather than reusing that
 * one with a renamed parameter. */
export function gsaKey(talkerId: string, systemId: string | null): string {
  return `${talkerId}:${systemId ?? ''}`;
}

interface GsvAssembly {
  totalMsgs: number;
  slots: (SatelliteInView[] | undefined)[]; // index 0..totalMsgs-1, undefined = not yet seen this epoch
  firstSlotAtMs: number; // wall-clock time this assembly was started (see STALE_ASSEMBLY_MS below)
}

export interface SatellitesState {
  assemblies: Record<string, GsvAssembly>; // in-progress, not yet complete
  constellations: Record<string, ConstellationSatellites>; // last COMPLETE group per key
  gsaByKey: Record<string, GsaInfo>; // latest full-GSA per constellation key, see applyGsaSentence below
}

export const initialSatellitesState: SatellitesState = { assemblies: {}, constellations: {}, gsaByKey: {} };

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
    gsaByKey: state.gsaByKey,
  };
}

/** Folds one full-GSA sentence into gsaByKey -- PLAN.md §6 phase 2. Unlike
 * applyGsvSentence, a single GSA sentence is already complete on its own
 * (no multi-sentence reassembly, no staleness concern -- see this file's
 * header comment on why GSV needs that and GSA doesn't), so this is
 * usually just an immutable upsert: compute the key, build a GsaInfo,
 * store it.
 *
 * The one exception: gsaKey() collapses onto the SAME string key (e.g.
 * 'GN:') whenever two DIFFERENT constellations both report under the
 * shared 'GN' talker AND both omit the System ID field -- a real, known-
 * possible receiver behavior (see GsaInfo.possiblyMixed's own comment,
 * and docs/GPS-MONITOR-PLAN.md §4's discussion of this exact ambiguity).
 * A plain replace in that specific case would silently discard the first
 * arrival's entire usedPrns list the moment the second constellation's
 * GSA lands under the same key -- so when BOTH the existing entry and the
 * incoming sentence have that ambiguous shape, this unions usedPrns
 * (deduplicated) instead of replacing it, so a satellite reported as used
 * by either arrival stays visible. Scalar fields (fixType/pdop/hdop/vdop)
 * can't be meaningfully merged across two different constellations, so
 * those stay last-write-wins even in the ambiguous case -- only usedPrns
 * accumulates. Every other case (a real per-constellation talker like
 * 'GP'/'GL'/'GA', or a 'GN' talker that DOES have a systemId) keeps the
 * existing plain-replace behavior: a talker/systemId-qualified key
 * reliably belongs to one real constellation reporting again, so stale
 * satellites shouldn't linger and replace semantics are correct there. */
export function applyGsaSentence(state: SatellitesState, sentence: FullGsaSentence): SatellitesState {
  const key = gsaKey(sentence.talkerId, sentence.systemId);
  const possiblyMixed = sentence.talkerId === 'GN' && sentence.systemId === null;
  const existing = state.gsaByKey[key];

  const usedPrns =
    possiblyMixed && existing?.possiblyMixed
      ? Array.from(new Set([...existing.usedPrns, ...sentence.satellitePrns]))
      : sentence.satellitePrns.slice();

  const info: GsaInfo = {
    key,
    talkerId: sentence.talkerId,
    systemId: sentence.systemId,
    fixType: sentence.fixType,
    usedPrns,
    pdop: sentence.pdop,
    hdop: sentence.hdop,
    vdop: sentence.vdop,
    possiblyMixed,
  };
  return {
    ...state,
    gsaByKey: { ...state.gsaByKey, [key]: info },
  };
}

/** A satellite as displayed once cross-referenced against a GSA's used-PRN
 * list -- see withUsedInFix() below. Not stored anywhere; computed on
 * demand (e.g. from a Svelte $derived in the UI layer) so GSV completions
 * and GSA arrivals never need to be kept in lockstep inside this file's
 * own reducers. */
export interface DisplaySatellite extends SatelliteInView {
  usedInFix: boolean;
}

/** Overlays usedInFix onto a satellite list given the set of PRNs actually
 * used in a fix -- pure, no knowledge of where either list came from
 * (GSV reassembly vs. full-GSA parsing). Does not mutate its inputs. */
export function withUsedInFix(satellites: SatelliteInView[], usedPrns: number[]): DisplaySatellite[] {
  const used = new Set(usedPrns);
  return satellites.map((satellite) => ({ ...satellite, usedInFix: used.has(satellite.prn) }));
}

/** Finds the GsaInfo (if any) that corresponds to a GSV constellation's
 * talkerId -- PLAN.md §4's GSA/GSV cross-reference join. Tries two
 * strategies in order:
 *
 * 1. Direct talkerId match -- covers the common case (per-constellation-
 *    talker receivers, e.g. GPGSV's talkerId 'GP' matches a GPGSA whose
 *    own talkerId is also 'GP').
 * 2. System-ID-derived name match -- covers a shared "GN" talker (the
 *    receiver's GSA sentences don't carry a distinguishing talkerId of
 *    their own), matched instead by comparing describeSystemId(gsa.systemId)
 *    against describeConstellation(gsvTalkerId) -- both should produce the
 *    same human name (e.g. both 'GPS') for the same real constellation.
 *
 * Returns null if neither matches -- a documented, known gap (see plan
 * doc §4 item 3: a receiver that shares BOTH a talker ID AND omits
 * System ID can't be disambiguated by this app; leaving usedInFix false
 * for everything in that case is the safe default, not a guess). */
export function findMatchingGsa(gsaByKey: Record<string, GsaInfo>, gsvTalkerId: string): GsaInfo | null {
  const candidates = Object.values(gsaByKey);

  const direct = candidates.find((info) => info.talkerId === gsvTalkerId);
  if (direct) return direct;

  const gsvName = describeConstellation(gsvTalkerId);
  const bySystemId = candidates.find(
    (info) => info.systemId !== null && describeSystemId(info.systemId) === gsvName,
  );
  return bySystemId ?? null;
}
