import { describe, expect, it } from 'vitest';
import { applyNmeaSentence, initialNmeaFixState, type NmeaFixState } from './nmeaFix';
import type { GgaSentence, RmcSentence } from './nmea';

const GOOD_GGA: GgaSentence = {
  type: 'GGA',
  timeOfDay: { hours: 12, minutes: 0, seconds: 0 },
  lat: 40.92,
  lon: -1.3,
  fixQuality: 1,
  numSatellites: 8,
  hdop: 0.9,
  altitudeM: 900,
};

const NO_FIX_GGA: GgaSentence = {
  ...GOOD_GGA,
  timeOfDay: { hours: 12, minutes: 0, seconds: 1 },
  fixQuality: 0,
  lat: null,
  lon: null,
  altitudeM: null,
  numSatellites: 3,
  hdop: 99.9,
};

const GOOD_RMC: RmcSentence = {
  type: 'RMC',
  timeOfDay: { hours: 12, minutes: 0, seconds: 0 },
  status: 'A',
  lat: 40.92,
  lon: -1.3,
  date: { day: 12, month: 8, year: 2026 },
};

const VOID_RMC: RmcSentence = {
  ...GOOD_RMC,
  timeOfDay: { hours: 12, minutes: 0, seconds: 1 },
  status: 'V',
  lat: null,
  lon: null,
};

describe('applyNmeaSentence', () => {
  it('adopts lat/lon/altitude/fix info from a good GGA', () => {
    const state = applyNmeaSentence(initialNmeaFixState, GOOD_GGA);
    expect(state).toMatchObject({
      hasFix: true,
      fixQuality: 1,
      lat: 40.92,
      lon: -1.3,
      altitudeM: 900,
      numSatellites: 8,
      hdop: 0.9,
    });
  });

  it('freezes the last good position when a subsequent GGA reports no fix', () => {
    const locked = applyNmeaSentence(initialNmeaFixState, GOOD_GGA);
    const lost = applyNmeaSentence(locked, NO_FIX_GGA);
    expect(lost.hasFix).toBe(false);
    expect(lost.fixQuality).toBe(0);
    // last known-good position, NOT nulled out by the no-fix sentence
    expect(lost.lat).toBe(40.92);
    expect(lost.lon).toBe(-1.3);
    expect(lost.altitudeM).toBe(900);
    // satellite/HDOP readout still updates even without a fix (useful
    // for a "searching, 3 sats" style status line)
    expect(lost.numSatellites).toBe(3);
    expect(lost.hdop).toBe(99.9);
  });

  it('freezes the last good position when RMC goes void', () => {
    const locked = applyNmeaSentence(initialNmeaFixState, GOOD_RMC);
    const lost = applyNmeaSentence(locked, VOID_RMC);
    expect(lost.hasFix).toBe(false);
    expect(lost.lat).toBe(40.92);
    expect(lost.lon).toBe(-1.3);
  });

  it('RMC updates lat/lon without touching GGA-only fields', () => {
    let state: NmeaFixState = applyNmeaSentence(initialNmeaFixState, GOOD_GGA);
    state = applyNmeaSentence(state, { ...GOOD_RMC, lat: 41.5, lon: -1.5 });
    expect(state.lat).toBe(41.5);
    expect(state.lon).toBe(-1.5);
    // untouched by RMC -- still GOOD_GGA's own readings
    expect(state.altitudeM).toBe(900);
    expect(state.numSatellites).toBe(8);
    expect(state.hdop).toBe(0.9);
  });

  it('utc stays null until a date arrives, then re-stamps with each new time', () => {
    let state: NmeaFixState = applyNmeaSentence(initialNmeaFixState, GOOD_GGA);
    expect(state.utc).toBeNull(); // GGA alone never carries a date

    state = applyNmeaSentence(state, GOOD_RMC); // supplies 2026-08-12
    expect(state.utc).toEqual(new Date(Date.UTC(2026, 7, 12, 12, 0, 0)));

    // a later GGA-only time update re-stamps using the date RMC already
    // established, not a re-null
    state = applyNmeaSentence(state, { ...GOOD_GGA, timeOfDay: { hours: 12, minutes: 0, seconds: 30 } });
    expect(state.utc).toEqual(new Date(Date.UTC(2026, 7, 12, 12, 0, 30)));
  });

  it('carries fractional seconds into milliseconds', () => {
    const state = applyNmeaSentence(initialNmeaFixState, {
      ...GOOD_RMC,
      timeOfDay: { hours: 12, minutes: 0, seconds: 0.5 },
    });
    expect(state.utc).toEqual(new Date(Date.UTC(2026, 7, 12, 12, 0, 0, 500)));
  });
});
