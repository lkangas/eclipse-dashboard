import { describe, expect, it } from 'vitest';
import { applyExtraSentence, initialExtrasState } from './nmeaExtras';
import type { GllSentence, GnsSentence, HdgSentence, RmcExtrasSentence, VtgSentence, ZdaSentence } from './nmeaRich';

const vtg1: VtgSentence = {
  type: 'VTG',
  talkerId: 'GN',
  courseTrueDeg: 45,
  courseMagDeg: 44,
  speedKnots: 3.2,
  speedKmh: 5.9,
  mode: 'A',
};

const vtg2: VtgSentence = { ...vtg1, courseTrueDeg: 90 };

const gll1: GllSentence = {
  type: 'GLL',
  talkerId: 'GN',
  lat: 40.5,
  lon: -3.7,
  timeOfDay: { hours: 12, minutes: 0, seconds: 0 },
  status: 'A',
  mode: 'A',
};

const zda1: ZdaSentence = {
  type: 'ZDA',
  talkerId: 'GP',
  timeOfDay: { hours: 12, minutes: 0, seconds: 0 },
  day: 12,
  month: 8,
  year: 2026,
  zoneHours: 0,
  zoneMinutes: 0,
};

const hdg1: HdgSentence = {
  type: 'HDG',
  talkerId: 'GP',
  headingDeg: 90,
  deviationDeg: 1,
  deviationDir: 'E',
  variationDeg: 2,
  variationDir: 'W',
};

const gns1: GnsSentence = {
  type: 'GNS',
  talkerId: 'GN',
  timeOfDay: { hours: 12, minutes: 0, seconds: 0 },
  lat: 40.5,
  lon: -3.7,
  modeIndicator: 'AAN',
  numSatellites: 12,
  hdop: 0.9,
  altitudeM: 545.4,
  geoidSepM: 46.9,
  navStatus: 'S',
};

const rmcExtras1: RmcExtrasSentence = {
  type: 'RMC',
  talkerId: 'GN',
  speedKnots: 3.2,
  courseDeg: 45,
  magVariationDeg: 2,
  magVariationDir: 'W',
  mode: 'A',
  navStatus: 'S',
};

describe('applyExtraSentence', () => {
  it('starts with everything null', () => {
    expect(initialExtrasState).toEqual({ vtg: null, gll: null, zda: null, hdg: null, gns: null, rmcExtras: null });
  });

  it('stores a VTG sentence under .vtg, leaving every other field untouched', () => {
    const state = applyExtraSentence(initialExtrasState, vtg1);
    expect(state.vtg).toBe(vtg1);
    expect(state.gll).toBeNull();
    expect(state.zda).toBeNull();
    expect(state.hdg).toBeNull();
    expect(state.gns).toBeNull();
    expect(state.rmcExtras).toBeNull();
  });

  it('replaces the previous sentence of the same type -- latest wins, no accumulation', () => {
    let state = applyExtraSentence(initialExtrasState, vtg1);
    state = applyExtraSentence(state, vtg2);
    expect(state.vtg).toBe(vtg2);
  });

  it('stores each sentence type under its own independent slot', () => {
    let state = initialExtrasState;
    state = applyExtraSentence(state, vtg1);
    state = applyExtraSentence(state, gll1);
    state = applyExtraSentence(state, zda1);
    state = applyExtraSentence(state, hdg1);
    state = applyExtraSentence(state, gns1);
    state = applyExtraSentence(state, rmcExtras1);

    expect(state.vtg).toBe(vtg1);
    expect(state.gll).toBe(gll1);
    expect(state.zda).toBe(zda1);
    expect(state.hdg).toBe(hdg1);
    expect(state.gns).toBe(gns1);
    expect(state.rmcExtras).toBe(rmcExtras1);
  });

  it('does not mutate the previous state object', () => {
    const before = { ...initialExtrasState };
    applyExtraSentence(initialExtrasState, vtg1);
    expect(initialExtrasState).toEqual(before);
  });
});
