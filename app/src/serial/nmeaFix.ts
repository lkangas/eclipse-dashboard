// A GPS receiver interleaves GGA (fix quality, altitude, satellite
// count), RMC (date, active/void status), and GSA (2D/3D fix type) once
// an epoch each -- this merges all three into one running "current fix"
// a UI or the observer store can read directly, rather than making every
// caller track all three sentence types itself. Pure reducer (old state
// + one parsed sentence -> new state), same testable-without-a-real-
// device shape as nmea.ts.
import type { NmeaDate, NmeaSentence, NmeaTimeOfDay } from './nmea';

export interface NmeaFixState {
  /** True only while the most recently seen sentence (GGA fixQuality>0,
   * or RMC status 'A') actually reports a live fix -- NOT just "we've
   * ever had one". lat/lon/altitudeM below intentionally do NOT clear
   * when this goes false: a receiver that briefly loses lock should
   * freeze at its last known position (and let the UI show "no fix"),
   * not snap the observer to null/0,0. */
  hasFix: boolean;
  lat: number | null;
  lon: number | null;
  altitudeM: number | null;
  /** Last GGA fix-quality code (0 = no fix / no GGA seen yet), kept even
   * while hasFix is false so a "no fix (searching, 3 sats)" style
   * message has something to show. */
  fixQuality: number;
  numSatellites: number | null;
  hdop: number | null;
  /** GSA's own fix-type code (1=no fix, 2=2D, 3=3D) -- null until at
   * least one GSA has been seen (not every receiver/config emits it).
   * Independent of fixQuality above -- see GsaSentence's own comment in
   * nmea.ts for why they're two different axes, not one combined value.
   * Kept even while hasFix is false, same reasoning as fixQuality. */
  fixType: number | null;
  /** Combined UTC date+time -- null until at least one RMC has supplied
   * a date (GGA/RMC's own time-of-day field has no date component). */
  utc: Date | null;
}

export const initialNmeaFixState: NmeaFixState = {
  hasFix: false,
  lat: null,
  lon: null,
  altitudeM: null,
  fixQuality: 0,
  numSatellites: null,
  hdop: null,
  fixType: null,
  utc: null,
};

// Re-stamps whatever date is already known (or the one this sentence
// just supplied) with a fresh time-of-day. A GGA-only stream (no RMC)
// never produces a date, so utc stays null indefinitely rather than
// guessing one -- correct is better than a plausible-looking wrong date.
function withTime(prevUtc: Date | null, date: NmeaDate | null, time: NmeaTimeOfDay | null): Date | null {
  if (!time) return prevUtc;
  const d = date ?? (prevUtc && { day: prevUtc.getUTCDate(), month: prevUtc.getUTCMonth() + 1, year: prevUtc.getUTCFullYear() });
  if (!d) return null;
  const wholeSeconds = Math.floor(time.seconds);
  const ms = Math.round((time.seconds - wholeSeconds) * 1000);
  return new Date(Date.UTC(d.year, d.month - 1, d.day, time.hours, time.minutes, wholeSeconds, ms));
}

export function applyNmeaSentence(state: NmeaFixState, sentence: NmeaSentence): NmeaFixState {
  if (sentence.type === 'GGA') {
    const fixed = sentence.fixQuality > 0;
    return {
      ...state,
      hasFix: fixed,
      fixQuality: sentence.fixQuality,
      lat: fixed && sentence.lat !== null ? sentence.lat : state.lat,
      lon: fixed && sentence.lon !== null ? sentence.lon : state.lon,
      altitudeM: fixed && sentence.altitudeM !== null ? sentence.altitudeM : state.altitudeM,
      numSatellites: sentence.numSatellites,
      hdop: sentence.hdop,
      utc: withTime(state.utc, null, sentence.timeOfDay),
    };
  }

  if (sentence.type === 'GSA') {
    // Only fixType changes -- GSA carries no lat/lon/time/quality of its
    // own, so everything else stays exactly as the last GGA/RMC left it.
    return { ...state, fixType: sentence.fixType };
  }

  // RMC doesn't carry satellite count/HDOP/altitude -- those fields are
  // simply omitted from this spread, leaving GGA's last report in place.
  const fixed = sentence.status === 'A';
  return {
    ...state,
    hasFix: fixed,
    lat: fixed && sentence.lat !== null ? sentence.lat : state.lat,
    lon: fixed && sentence.lon !== null ? sentence.lon : state.lon,
    utc: withTime(state.utc, sentence.date, sentence.timeOfDay),
  };
}
