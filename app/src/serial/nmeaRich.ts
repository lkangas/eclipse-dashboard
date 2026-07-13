// PLAN.md §7: the "rich" NMEA parser for the GPS monitor's diagnostic
// panels -- deliberately a separate module from nmea.ts, not an
// extension of it. nmea.ts is the safety/product-critical core pipeline
// (GGA/RMC/GSA-fixType -> nmeaFix.ts -> the observer) and must keep zero
// shared surface with monitor-only code, even at the cost of duplicating
// a handful of small parsing primitives (checksum validation, toFloat/
// toInt) below. See the plan doc's §7 "full separation" recommendation.
//
// Unlike nmea.ts, this parser DOES track talker ID (GP/GL/GA/GB/GN/...),
// since the whole point of the rich monitor is per-constellation display
// -- nmea.ts ignores talker ID on purpose (one merged fix regardless of
// constellation); this file is the opposite case.
//
// Phase 1 scope: GSV only. Full GSA (PRN list/PDOP/VDOP), VTG, GLL, ZDA,
// HDG, GNS are later phases (see plan doc §6) and intentionally not
// stubbed out here.

export interface GsvSatelliteSlot {
  prn: number;
  /** 0-90 degrees above the horizon, null if the receiver didn't report it. */
  elevationDeg: number | null;
  /** 0-359 degrees true north, null if the receiver didn't report it. */
  azimuthDeg: number | null;
  /** 0-99 dB-Hz, null if this satellite is visible but not tracking/no
   * signal (a real, common state -- not a parse failure). */
  snrDb: number | null;
}

export interface GsvSentence {
  type: 'GSV';
  talkerId: string;
  /** Total number of GSV messages in this constellation's run this epoch. */
  totalMsgs: number;
  /** This message's own 1-indexed number within the run. */
  msgNum: number;
  /** Total satellite count field -- the whole constellation's visible
   * count, not just this message's own up-to-4 slice. */
  satellitesInView: number | null;
  /** Only this message's own up-to-4 satellites, not the whole run --
   * reassembly across the run is a separate reducer's job (nmeaSatellites.ts,
   * a later phase), not this parser's. */
  satellites: GsvSatelliteSlot[];
  /** NMEA 4.10+ trailing field, null if absent (older/simpler receivers). */
  signalId: string | null;
}

// Widen with a union (GsaSentence | VtgSentence | ...) as later phases add
// sentence types -- see plan doc §6/§7.
export type RichNmeaSentence = GsvSentence;

// Same XOR-checksum logic as nmea.ts's own private checksumValid -- see
// that file's comment for why rejecting bad checksums matters more on a
// live serial stream than on parsed static data. Duplicated here rather
// than imported, by design (see this file's header comment).
function checksumValid(sentence: string): boolean {
  if (!sentence.startsWith('$')) return false;
  const starIdx = sentence.indexOf('*');
  if (starIdx === -1) return false;
  const given = sentence.slice(starIdx + 1, starIdx + 3);
  if (given.length !== 2) return false;
  let checksum = 0;
  for (let i = 1; i < starIdx; i++) checksum ^= sentence.charCodeAt(i);
  return checksum.toString(16).toUpperCase().padStart(2, '0') === given.toUpperCase();
}

function toFloat(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function toInt(raw: string | undefined): number | null {
  const v = toFloat(raw);
  return v === null ? null : Math.trunc(v);
}

/** Parses one NMEA line (no trailing CR/LF expected -- same convention as
 * nmea.ts's parseNmeaSentence, the serial reader line-splits before
 * calling this) into a typed GSV sentence, or null for anything else: a
 * bad checksum, a non-GSV sentence type, or a malformed run (bad
 * totalMsgs/msgNum). Unlike nmea.ts, the talker ID is kept -- it's the
 * key the caller needs for per-constellation reassembly/display. */
export function parseRichNmeaSentence(line: string): RichNmeaSentence | null {
  const sentence = line.trim();
  if (!checksumValid(sentence)) return null;
  const starIdx = sentence.indexOf('*');
  const fields = sentence.slice(1, starIdx).split(',');
  const address = fields[0] ?? '';
  if (address.length < 3) return null;
  const talkerId = address.slice(0, -3);
  const sentenceId = address.slice(-3);
  if (sentenceId !== 'GSV') return null;

  const totalMsgs = toInt(fields[1]);
  const msgNum = toInt(fields[2]);
  const satellitesInView = toInt(fields[3]);
  if (totalMsgs === null || msgNum === null) return null;
  if (totalMsgs < 1 || msgNum < 1 || msgNum > totalMsgs) return null;

  // Each message can carry up to 4 satellite groups of 4 fields each
  // (PRN, elevation, azimuth, SNR), optionally followed by a single
  // trailing Signal ID field (NMEA 4.10+). A receiver may either pad an
  // unused trailing slot with empty fields (e.g. ",,,,") or drop trailing
  // fields (and their commas) entirely -- both conventions are handled
  // below by only ever requiring a group's PRN sub-field to be present,
  // never all 4.
  //
  // The tricky part is telling a genuinely truncated last satellite group
  // apart from a trailing Signal ID field, since both eat into the same
  // trailing fields -- `rest.length % 4` alone can't do this reliably: a
  // message can validly end with anywhere from 0 to 4 raw fields for its
  // last satellite, so the remainder alone is ambiguous (e.g. a dropped
  // SNR sub-field plus a real signal ID can leave the same remainder as a
  // fully-populated last group with no signal ID at all). Instead, work
  // out how many satellite slots THIS message is expected to carry from
  // satellitesInView/msgNum/totalMsgs -- every message but the last in a
  // run carries 4, the last carries whatever's left over -- and only
  // ever read a field beyond that expected satellite-field allotment as
  // the Signal ID.
  const rest = fields.slice(4);

  const expectedSatCount = ((): number | null => {
    if (satellitesInView === null) return null;
    if (msgNum < totalMsgs) return 4;
    const remaining = satellitesInView - 4 * (msgNum - 1);
    return Math.max(0, Math.min(4, remaining)); // defensive clamp to a sane range
  })();

  // satellitesInView is nullable in practice (rare, but some receivers
  // omit it) -- when the expected allotment genuinely can't be computed,
  // fall back to the old mod-4 heuristic rather than regressing to
  // "never has a signal ID". This fallback keeps the same blind spot the
  // old code always had (it can't tell a truncated last satellite group
  // apart from a trailing Signal ID field), it just no longer applies
  // when the better, count-based method is available.
  const hasSignalId =
    expectedSatCount !== null ? rest.length > 4 * expectedSatCount : rest.length % 4 === 1;
  const signalId = hasSignalId ? rest[rest.length - 1] || null : null;
  const satFields = hasSignalId ? rest.slice(0, -1) : rest;

  // Walk satellite groups of 4 fields at a time. Only the last group can
  // come up short -- the standard NMEA trailing-omission convention only
  // ever truncates the end of a sentence -- so satFields[i+1..3] simply
  // read as undefined past the end of the array on that final
  // iteration, and toFloat/toInt already turn that into null. That means
  // a genuinely truncated last satellite still produces an entry, as
  // long as its PRN sub-field is present, with nulls for whichever of
  // elevation/azimuth/snr are missing.
  const satellites: GsvSatelliteSlot[] = [];
  for (let i = 0; i < satFields.length; i += 4) {
    const prn = toInt(satFields[i]);
    if (prn === null) continue; // empty/omitted PRN -- padded or dropped unused slot, skip
    satellites.push({
      prn,
      elevationDeg: toFloat(satFields[i + 1]),
      azimuthDeg: toFloat(satFields[i + 2]),
      snrDb: toFloat(satFields[i + 3]),
    });
  }

  return {
    type: 'GSV',
    talkerId,
    totalMsgs,
    msgNum,
    satellitesInView,
    satellites,
    signalId,
  };
}
