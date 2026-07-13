// PLAN.md §5 #4: parses the NMEA 0183 sentences this app needs -- GGA
// (fix quality, altitude), RMC (date, active/void status), and GSA (2D
// vs 3D fix type). Pure and DOM-free by design (no navigator.serial
// here) so it's fully unit-testable against known sentences without a
// real device -- see connection.ts for the Web Serial glue that feeds it
// live lines.

export interface NmeaTimeOfDay {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface NmeaDate {
  day: number;
  month: number;
  /** Expanded from NMEA's 2-digit year via a fixed 2000+yy pivot -- fine
   * through 2099, and this app only ever deals with 2026 anyway. */
  year: number;
}

export interface GgaSentence {
  type: 'GGA';
  timeOfDay: NmeaTimeOfDay | null;
  lat: number | null;
  lon: number | null;
  /** 0 = no fix, 1 = GPS, 2 = DGPS, 4/5 = RTK -- anything >0 is usable. */
  fixQuality: number;
  numSatellites: number | null;
  hdop: number | null;
  /** Altitude above mean sea level, meters -- the GGA field is already
   * MSL (geoid-corrected), not the raw WGS84 ellipsoid height, so it's
   * directly comparable to elevation.ts's DEM values. */
  altitudeM: number | null;
}

export interface RmcSentence {
  type: 'RMC';
  timeOfDay: NmeaTimeOfDay | null;
  /** 'A' = active/valid fix, 'V' = void -- RMC's own fix indicator,
   * independent of (and usually but not always in lockstep with) GGA's
   * fixQuality from the same receiver. */
  status: 'A' | 'V';
  lat: number | null;
  lon: number | null;
  date: NmeaDate | null;
}

export interface GsaSentence {
  type: 'GSA';
  /** GSA's own Mode 2 field -- 1 = no fix, 2 = 2D (no reliable altitude),
   * 3 = 3D. Independent of GGA's fixQuality (SPS/DGPS/RTK/...): a
   * receiver can report e.g. "3D + DGPS" at once, since these describe
   * different axes of the same fix, not one combined scale. */
  fixType: number;
}

export type NmeaSentence = GgaSentence | RmcSentence | GsaSentence;

// XOR of every byte between '$' and '*', hex-encoded -- the standard
// NMEA 0183 checksum. Rejecting bad checksums up front matters more here
// than on parsed static data: a live serial stream WILL contain torn
// lines (mid-baud-change garbage, a connect landing mid-sentence), and
// silently parsing a corrupted line into a wrong-but-plausible lat/lon
// would be worse than just dropping it.
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

// ddmm.mmmm (lat) / dddmm.mmmm (lon) -> signed decimal degrees. The
// degrees part is everything before the last two whole digits ahead of
// the decimal point -- that boundary is fixed by the format regardless
// of how many digits the (variable-width) minutes/seconds fraction has,
// which is why this isn't just "split on the first two/three chars".
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

function parseTimeOfDay(raw: string | undefined): NmeaTimeOfDay | null {
  if (!raw || raw.length < 6) return null;
  const hours = Number(raw.slice(0, 2));
  const minutes = Number(raw.slice(2, 4));
  const seconds = Number(raw.slice(4));
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return { hours, minutes, seconds };
}

function parseDdmmyy(raw: string | undefined): NmeaDate | null {
  if (!raw || raw.length !== 6) return null;
  const day = Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const yy = Number(raw.slice(4, 6));
  if (![day, month, yy].every(Number.isFinite)) return null;
  return { day, month, year: 2000 + yy };
}

/** Parses one NMEA line (no trailing CR/LF expected -- the serial reader
 * line-splits before calling this) into a typed GGA/RMC sentence, or
 * null for anything else: a bad checksum, a sentence type this app
 * doesn't need (GSA/GSV/VTG/GLL/...), or a malformed/torn line. The
 * talker ID (GP/GN/GL/GA/GB/...) is deliberately ignored -- matched by
 * the sentence's last 3 letters only -- since which constellations a
 * receiver reports under isn't this app's concern, only the fix itself. */
export function parseNmeaSentence(line: string): NmeaSentence | null {
  const sentence = line.trim();
  if (!checksumValid(sentence)) return null;
  const starIdx = sentence.indexOf('*');
  const fields = sentence.slice(1, starIdx).split(',');
  const address = fields[0] ?? '';
  if (address.length < 3) return null;
  const sentenceId = address.slice(-3);

  if (sentenceId === 'GGA') {
    const [, time, lat, latHem, lon, lonHem, quality, numSats, hdop, alt] = fields;
    return {
      type: 'GGA',
      timeOfDay: parseTimeOfDay(time),
      lat: toDecimalDegrees(lat, latHem),
      lon: toDecimalDegrees(lon, lonHem),
      fixQuality: toInt(quality) ?? 0,
      numSatellites: toInt(numSats),
      hdop: toFloat(hdop),
      altitudeM: toFloat(alt),
    };
  }

  if (sentenceId === 'RMC') {
    const [, time, status, lat, latHem, lon, lonHem, , , date] = fields;
    if (status !== 'A' && status !== 'V') return null;
    return {
      type: 'RMC',
      timeOfDay: parseTimeOfDay(time),
      status,
      lat: toDecimalDegrees(lat, latHem),
      lon: toDecimalDegrees(lon, lonHem),
      date: parseDdmmyy(date),
    };
  }

  if (sentenceId === 'GSA') {
    // fields[0] is the address, fields[1] is GSA's Mode 1 (M/A, manual
    // vs automatic 2D/3D selection -- not needed here); Mode 2 (the fix
    // type itself) is fields[2]. The satellite-PRN and PDOP/HDOP/VDOP
    // fields after it aren't parsed -- HDOP already comes from GGA.
    const [, , mode2] = fields;
    const fixType = toInt(mode2);
    if (fixType === null) return null;
    return { type: 'GSA', fixType };
  }

  return null;
}
