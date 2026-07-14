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
// Phase 1: GSV. Phase 2: full GSA (PRN list actually used in the fix,
// PDOP/HDOP/VDOP, optional trailing System ID) -- unlike nmea.ts's own
// GSA handling (which only ever reads Mode 2/fixType and ignores
// everything else, since that's all the core fix pipeline needs), this
// parser reads the whole sentence, talker-ID-aware, for the rich
// monitor's per-constellation GSA panels (PLAN.md §4 and §6 phase 2).
// Phase 3 (this file's current scope, PLAN.md §6): VTG, GLL, ZDA, HDG,
// GNS -- each a single once-per-epoch sentence with no reassembly, plus
// a richer RMC parse (speed/course/mag-variation/mode/nav-status) for the
// fields nmea.ts's own minimal, safety-critical RmcSentence doesn't carry
// (PLAN.md §2's "Corrections from an actual screenshot": "add to Phase
// 3's RMC-extras scope"). Deliberately its own type (RmcExtrasSentence,
// not nmea.ts's RmcSentence) even though it shares the 'RMC' tag -- same
// zero-shared-surface reasoning as this file's header comment; nmea.ts's
// RmcSentence and this file's RichNmeaSentence are never unioned
// together, so the shared literal tag can't be ambiguous to the compiler,
// only to a reader -- worth knowing if this ever gets confusing enough to
// rename.

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

export interface FullGsaSentence {
  type: 'GSA';
  talkerId: string;
  /** Mode 2 field -- 1 = no fix, 2 = 2D (no reliable altitude), 3 = 3D.
   * Same meaning as nmea.ts's own GsaSentence.fixType, duplicated here
   * (not imported -- see this file's header comment on zero shared
   * surface) since the rich monitor's per-constellation GSA panels need
   * their own copy alongside the fields nmea.ts never reads. */
  fixType: number;
  /** PRNs actually USED in this fix (not merely visible -- that's GSV's
   * job) -- empty slots among GSA's fixed 12 SV sub-fields are skipped,
   * not zero-padded into the array, same "skip empty, don't pad"
   * convention this file's own GSV satellite-slot parsing already uses. */
  satellitePrns: number[];
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
  /** NMEA 4.11+ trailing field disambiguating which constellation this
   * GSA belongs to when multiple GSA sentences share one talker ID (e.g.
   * a shared "GN" talker) -- see PLAN.md §4. Null when the receiver
   * doesn't emit it (older/simpler receivers, or ones that instead use a
   * per-constellation talker ID). Numeric string, e.g. '1' (GPS) .. '6'
   * (NavIC) -- see monitor.ts's describeSystemId() for the mapping. */
  systemId: string | null;
}

/** Duplicated shape of nmea.ts's own NmeaTimeOfDay -- see this file's
 * header comment on why nothing is imported from nmea.ts. */
export interface RichTimeOfDay {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface VtgSentence {
  type: 'VTG';
  talkerId: string;
  courseTrueDeg: number | null;
  courseMagDeg: number | null;
  speedKnots: number | null;
  speedKmh: number | null;
  /** NMEA 2.3+ positioning-system mode indicator (A/D/E/M/S/F/R), null on
   * older receivers that omit it -- see monitor.ts's describeModeIndicator(). */
  mode: string | null;
}

export interface GllSentence {
  type: 'GLL';
  talkerId: string;
  lat: number | null;
  lon: number | null;
  timeOfDay: RichTimeOfDay | null;
  /** 'A' = valid/active, 'V' = void/invalid -- GLL's own fix-status field. */
  status: string | null;
  /** NMEA 2.3+ mode indicator, null on older receivers -- same codes as VtgSentence.mode. */
  mode: string | null;
}

export interface ZdaSentence {
  type: 'ZDA';
  talkerId: string;
  timeOfDay: RichTimeOfDay | null;
  day: number | null;
  month: number | null;
  /** Full 4-digit year -- unlike nmea.ts's RmcSentence.date, ZDA reports
   * this directly rather than a 2-digit year needing a pivot. */
  year: number | null;
  /** Local zone offset from UTC, -13..13. */
  zoneHours: number | null;
  zoneMinutes: number | null;
}

export interface HdgSentence {
  type: 'HDG';
  talkerId: string;
  /** Magnetic sensor heading -- NOT corrected for deviation/variation;
   * combine with the fields below for a true heading if needed. */
  headingDeg: number | null;
  deviationDeg: number | null;
  deviationDir: 'E' | 'W' | null;
  variationDeg: number | null;
  variationDir: 'E' | 'W' | null;
}

export interface GnsSentence {
  type: 'GNS';
  talkerId: string;
  timeOfDay: RichTimeOfDay | null;
  lat: number | null;
  lon: number | null;
  /** One mode character per reporting constellation, e.g. "AAN" -- see
   * monitor.ts's describeGnsModeIndicator() for the per-char breakdown. */
  modeIndicator: string | null;
  numSatellites: number | null;
  hdop: number | null;
  altitudeM: number | null;
  geoidSepM: number | null;
  /** NMEA 4.1+ trailing field (V/S/C/U), null on older receivers -- see
   * monitor.ts's describeNavStatus(). */
  navStatus: string | null;
}

/** A richer RMC parse than nmea.ts's own minimal, safety-critical
 * RmcSentence -- the extra fields the monitor's "GNRMC panel" wants
 * (PLAN.md §2's "Corrections from an actual screenshot") that the core
 * fix pipeline has no use for: speed, course, magnetic variation, mode
 * indicator, and (NMEA 4.1+) nav status. Deliberately does NOT duplicate
 * lat/lon/status/date -- those are already on screen via gpsConnection.fix,
 * sourced from nmea.ts's own RmcSentence; this type only adds what that
 * one doesn't carry. */
export interface RmcExtrasSentence {
  type: 'RMC';
  talkerId: string;
  speedKnots: number | null;
  courseDeg: number | null;
  magVariationDeg: number | null;
  magVariationDir: 'E' | 'W' | null;
  mode: string | null;
  navStatus: string | null;
}

// Widen with a union as later phases add sentence types -- see plan doc §6/§7.
export type RichNmeaSentence =
  | GsvSentence
  | FullGsaSentence
  | VtgSentence
  | GllSentence
  | ZdaSentence
  | HdgSentence
  | GnsSentence
  | RmcExtrasSentence;

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

// Same ddmm.mmmm/dddmm.mmmm -> signed decimal degrees logic as nmea.ts's
// own private toDecimalDegrees -- duplicated, not imported (see this
// file's header comment).
function toDecimalDegrees(raw: string | undefined, hemisphere: string | undefined): number | null {
  if (!raw || !hemisphere) return null;
  const dotIdx = raw.indexOf('.');
  if (dotIdx < 2) return null;
  const deg = Number(raw.slice(0, dotIdx - 2));
  const min = Number(raw.slice(dotIdx - 2));
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  const value = deg + min / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -value : value;
}

// Same hhmmss.ss parsing as nmea.ts's own private parseTimeOfDay --
// duplicated, not imported (see this file's header comment).
function parseTimeOfDay(raw: string | undefined): RichTimeOfDay | null {
  if (!raw || raw.length < 6) return null;
  const hours = Number(raw.slice(0, 2));
  const minutes = Number(raw.slice(2, 4));
  const seconds = Number(raw.slice(4));
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return { hours, minutes, seconds };
}

function toEW(raw: string | undefined): 'E' | 'W' | null {
  return raw === 'E' || raw === 'W' ? raw : null;
}

/** Parses GSA's fixed 12 SV sub-fields (fields[3]..fields[14] -- SV1..SV12)
 * into the PRNs actually used in the fix, skipping empty slots rather than
 * zero-padding them -- same convention this file's own GSV satellite-slot
 * parsing (below, in parseRichNmeaSentence) already uses. */
function parseGsaSatellitePrns(fields: string[]): number[] {
  const prns: number[] = [];
  for (let i = 3; i <= 14; i++) {
    const prn = toInt(fields[i]);
    if (prn !== null) prns.push(prn);
  }
  return prns;
}

/** Full GSA: Mode 2 (fixType), the 12-slot used-satellite-PRN list,
 * PDOP/HDOP/VDOP, and (NMEA 4.11+) the trailing System ID field -- see
 * FullGsaSentence's own field comments for what each means. `fields`
 * still includes fields[0] (the address); talkerId is passed separately
 * since the caller already split it off the address for both GSV and
 * GSA. Returns null if the overall field count isn't 18 or 19, or if
 * Mode 2 doesn't parse as a number -- same "reject the sentence, don't
 * half-populate it" behavior nmea.ts's own GSA handling uses for the one
 * field it reads. */
function parseGsa(talkerId: string, fields: string[]): FullGsaSentence | null {
  // fields[0]=address, fields[1]=Mode1, fields[2]=Mode2/fixType,
  // fields[3..14]=SV1..SV12, fields[15..17]=PDOP/HDOP/VDOP, and an
  // optional fields[18]=System ID -- exactly 18 or 19 fields total,
  // including the address. If a receiver drops a middle empty SV slot's
  // comma, every subsequent field shifts left by one and a DOP value
  // could land in the SV12 slot (parsed as a phantom "used" PRN) while
  // PDOP/HDOP/VDOP themselves get garbled -- so reject the sentence
  // outright rather than half-populate it, same philosophy already
  // applied to Mode 2/msgNum/totalMsgs elsewhere in this file.
  if (fields.length !== 18 && fields.length !== 19) return null;

  const fixType = toInt(fields[2]);
  if (fixType === null) return null;

  const satellitePrns = parseGsaSatellitePrns(fields);
  const pdop = toFloat(fields[15]);
  const hdop = toFloat(fields[16]);
  const vdop = toFloat(fields[17]);
  // fields[18] (a 19th field, index 18) is the optional trailing System
  // ID -- present only on NMEA 4.11+ receivers that emit it. The
  // fields.length check above already guarantees length is exactly 18 or
  // 19, so this is just "is the 19th field present".
  const systemId = fields.length === 19 ? fields[18] || null : null;

  return { type: 'GSA', talkerId, fixType, satellitePrns, pdop, hdop, vdop, systemId };
}

// The following six parsers (VTG/GLL/ZDA/HDG/GNS/RMC-extras, PLAN.md §6
// phase 3) are all single, once-per-epoch sentences with no reassembly --
// unlike GSA, they follow nmea.ts's own GGA/RMC precedent of destructuring
// by fixed position without a strict overall field-count check: none of
// them have GSA's specific hazard (a fixed run of optional middle slots
// whose dropped commas shift every later field), so a lenient read (missing
// trailing fields simply parse as null/undefined) is the right amount of
// defensiveness here, not GSA's stricter reject-the-whole-sentence rule.

function parseVtg(talkerId: string, fields: string[]): VtgSentence {
  const [, cogt, , cogm, , sogn, , sogk, , mode] = fields;
  return {
    type: 'VTG',
    talkerId,
    courseTrueDeg: toFloat(cogt),
    courseMagDeg: toFloat(cogm),
    speedKnots: toFloat(sogn),
    speedKmh: toFloat(sogk),
    mode: mode || null,
  };
}

function parseGll(talkerId: string, fields: string[]): GllSentence {
  const [, lat, latHem, lon, lonHem, time, status, mode] = fields;
  return {
    type: 'GLL',
    talkerId,
    lat: toDecimalDegrees(lat, latHem),
    lon: toDecimalDegrees(lon, lonHem),
    timeOfDay: parseTimeOfDay(time),
    status: status || null,
    mode: mode || null,
  };
}

function parseZda(talkerId: string, fields: string[]): ZdaSentence {
  const [, time, day, month, year, zoneHours, zoneMinutes] = fields;
  return {
    type: 'ZDA',
    talkerId,
    timeOfDay: parseTimeOfDay(time),
    day: toInt(day),
    month: toInt(month),
    year: toInt(year),
    zoneHours: toInt(zoneHours),
    zoneMinutes: toInt(zoneMinutes),
  };
}

function parseHdg(talkerId: string, fields: string[]): HdgSentence {
  const [, heading, deviation, deviationDir, variation, variationDir] = fields;
  return {
    type: 'HDG',
    talkerId,
    headingDeg: toFloat(heading),
    deviationDeg: toFloat(deviation),
    deviationDir: toEW(deviationDir),
    variationDeg: toFloat(variation),
    variationDir: toEW(variationDir),
  };
}

function parseGns(talkerId: string, fields: string[]): GnsSentence {
  const [, time, lat, latHem, lon, lonHem, modeIndicator, numSats, hdop, alt, geoidSep, , , navStatus] = fields;
  return {
    type: 'GNS',
    talkerId,
    timeOfDay: parseTimeOfDay(time),
    lat: toDecimalDegrees(lat, latHem),
    lon: toDecimalDegrees(lon, lonHem),
    modeIndicator: modeIndicator || null,
    numSatellites: toInt(numSats),
    hdop: toFloat(hdop),
    altitudeM: toFloat(alt),
    geoidSepM: toFloat(geoidSep),
    navStatus: navStatus || null,
  };
}

/** RMC's extra fields beyond nmea.ts's own minimal RmcSentence -- see
 * RmcExtrasSentence's own comment for why lat/lon/status/date aren't
 * repeated here. Field layout: fields[0]=address, [1]=time, [2]=status,
 * [3..6]=lat/latHem/lon/lonHem, [7]=speed(knots), [8]=course(true deg),
 * [9]=date(ddmmyy), [10..11]=magVariation/magVariationDir,
 * [12]=mode (NMEA 2.3+), [13]=navStatus (NMEA 4.1+). */
function parseRmcExtras(talkerId: string, fields: string[]): RmcExtrasSentence {
  const [, , , , , , , speed, course, , magVar, magVarDir, mode, navStatus] = fields;
  return {
    type: 'RMC',
    talkerId,
    speedKnots: toFloat(speed),
    courseDeg: toFloat(course),
    magVariationDeg: toFloat(magVar),
    magVariationDir: toEW(magVarDir),
    mode: mode || null,
    navStatus: navStatus || null,
  };
}

/** Parses one NMEA line (no trailing CR/LF expected -- same convention as
 * nmea.ts's parseNmeaSentence, the serial reader line-splits before
 * calling this) into a typed rich sentence, or null for anything else: a
 * bad checksum, an unrecognized sentence type, or a malformed GSV/GSA run.
 * Unlike nmea.ts, the talker ID is kept -- it's the key the caller needs
 * for per-constellation reassembly/display. */
export function parseRichNmeaSentence(line: string): RichNmeaSentence | null {
  const sentence = line.trim();
  if (!checksumValid(sentence)) return null;
  const starIdx = sentence.indexOf('*');
  const fields = sentence.slice(1, starIdx).split(',');
  const address = fields[0] ?? '';
  if (address.length < 3) return null;
  const talkerId = address.slice(0, -3);
  const sentenceId = address.slice(-3);
  if (sentenceId === 'GSA') return parseGsa(talkerId, fields);
  if (sentenceId === 'VTG') return parseVtg(talkerId, fields);
  if (sentenceId === 'GLL') return parseGll(talkerId, fields);
  if (sentenceId === 'ZDA') return parseZda(talkerId, fields);
  if (sentenceId === 'HDG') return parseHdg(talkerId, fields);
  if (sentenceId === 'GNS') return parseGns(talkerId, fields);
  if (sentenceId === 'RMC') return parseRmcExtras(talkerId, fields);
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
