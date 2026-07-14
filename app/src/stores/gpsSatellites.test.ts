// Unlike connection.ts (untested by design -- see its own comment), this
// module has no navigator.serial dependency, so it's exercised for real
// here: raw NMEA-line strings in, gpsSatellites store state out. Mirrors
// nmeaSatellites.test.ts's own multi-constellation/gap-handling cases,
// but through this module's raw-line entry point (applyRichNmeaLine)
// rather than by calling the reducer directly -- this module's whole job
// is that raw-line-in path, so the tests should exercise it.
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { satelliteGroupKey, gsaKey, initialSatellitesState } from '../serial/nmeaSatellites';
import { applyRichNmeaLine, gpsSatellites, resetGpsSatellites } from './gpsSatellites';

// Appends a correct checksum to a hand-built sentence body -- mirrors
// nmea.test.ts/nmeaSatellites.test.ts's own withChecksum helper.
function withChecksum(body: string): string {
  let checksum = 0;
  for (let i = 0; i < body.length; i++) checksum ^= body.charCodeAt(i);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}

// state is module-level (mirrors connection.ts's own latestFix
// convention -- see gpsSatellites.ts's comment), so it persists across
// tests unless explicitly reset. Every test starts from a clean slate.
beforeEach(() => {
  resetGpsSatellites();
});

describe('applyRichNmeaLine', () => {
  it('folds a complete 3-message GSV run into gpsSatellites', () => {
    applyRichNmeaLine(withChecksum('GPGSV,3,1,09,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'));
    applyRichNmeaLine(withChecksum('GPGSV,3,2,09,05,50,100,50,06,60,120,55,07,70,140,60,08,80,160,00'));
    applyRichNmeaLine(withChecksum('GPGSV,3,3,09,09,90,180,20'));

    const key = satelliteGroupKey('GP', null);
    const state = get(gpsSatellites);
    expect(state.assemblies[key]).toBeUndefined();
    expect(state.constellations[key]).toEqual({
      key,
      talkerId: 'GP',
      signalId: null,
      satellites: [
        { prn: 1, elevationDeg: 10, azimuthDeg: 20, snrDb: 30 },
        { prn: 2, elevationDeg: 20, azimuthDeg: 40, snrDb: 35 },
        { prn: 3, elevationDeg: 30, azimuthDeg: 60, snrDb: 40 },
        { prn: 4, elevationDeg: 40, azimuthDeg: 80, snrDb: 45 },
        { prn: 5, elevationDeg: 50, azimuthDeg: 100, snrDb: 50 },
        { prn: 6, elevationDeg: 60, azimuthDeg: 120, snrDb: 55 },
        { prn: 7, elevationDeg: 70, azimuthDeg: 140, snrDb: 60 },
        { prn: 8, elevationDeg: 80, azimuthDeg: 160, snrDb: 0 },
        { prn: 9, elevationDeg: 90, azimuthDeg: 180, snrDb: 20 },
      ],
      // A real Date.now() timestamp via this module's own applyRichNmeaLine
      // (unlike nmeaSatellites.test.ts's direct reducer calls, which pass
      // an explicit nowMs) -- any number is fine, this isn't testing timing.
      lastUpdatedMs: expect.any(Number),
    });
  });

  it('is a no-op for a non-GSV sentence (e.g. GGA)', () => {
    const before = get(gpsSatellites);
    applyRichNmeaLine(withChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'));
    expect(get(gpsSatellites)).toBe(before);
  });

  it('is a no-op for garbage that is not an NMEA sentence at all', () => {
    const before = get(gpsSatellites);
    applyRichNmeaLine('not a sentence');
    applyRichNmeaLine('');
    expect(get(gpsSatellites)).toBe(before);
  });

  it('is a no-op for a bad checksum', () => {
    const before = get(gpsSatellites);
    applyRichNmeaLine('$GPGSV,1,1,00*00');
    expect(get(gpsSatellites)).toBe(before);
  });

  it('correctly populates two interleaved constellations', () => {
    const gpKey = satelliteGroupKey('GP', null);
    const glKey = satelliteGroupKey('GL', null);

    applyRichNmeaLine(withChecksum('GPGSV,2,1,05,01,10,020,30,02,20,040,35'));
    applyRichNmeaLine(withChecksum('GLGSV,2,1,05,65,15,025,25,66,25,045,26'));
    applyRichNmeaLine(withChecksum('GPGSV,2,2,05,03,30,060,40'));
    applyRichNmeaLine(withChecksum('GLGSV,2,2,05,67,35,065,27'));

    const state = get(gpsSatellites);
    expect(state.assemblies[gpKey]).toBeUndefined();
    expect(state.assemblies[glKey]).toBeUndefined();
    expect(state.constellations[gpKey]).toMatchObject({
      talkerId: 'GP',
      satellites: [
        { prn: 1, elevationDeg: 10, azimuthDeg: 20, snrDb: 30 },
        { prn: 2, elevationDeg: 20, azimuthDeg: 40, snrDb: 35 },
        { prn: 3, elevationDeg: 30, azimuthDeg: 60, snrDb: 40 },
      ],
    });
    expect(state.constellations[glKey]).toMatchObject({
      talkerId: 'GL',
      satellites: [
        { prn: 65, elevationDeg: 15, azimuthDeg: 25, snrDb: 25 },
        { prn: 66, elevationDeg: 25, azimuthDeg: 45, snrDb: 26 },
        { prn: 67, elevationDeg: 35, azimuthDeg: 65, snrDb: 27 },
      ],
    });
  });

  it('folds a raw GSA line into gsaByKey (PLAN.md §6 phase 2)', () => {
    applyRichNmeaLine(withChecksum('GNGSA,A,3,18,20,21,26,,,,,,,,,1.94,1.18,1.54,1'));

    const key = gsaKey('GN', '1');
    const state = get(gpsSatellites);
    expect(state.gsaByKey[key]).toEqual({
      key,
      talkerId: 'GN',
      systemId: '1',
      fixType: 3,
      usedPrns: [18, 20, 21, 26],
      pdop: 1.94,
      hdop: 1.18,
      vdop: 1.54,
      possiblyMixed: false, // systemId is present ('1') -- not the ambiguous shape
      lastUpdatedMs: expect.any(Number),
    });
  });

  it('correctly reflects a GSV run and a GSA sentence interleaved in one snapshot', () => {
    const gsvKey = satelliteGroupKey('GP', null);
    const gsaKeyForGp = gsaKey('GP', null);

    applyRichNmeaLine(withChecksum('GPGSV,2,1,05,01,10,020,30,02,20,040,35'));
    applyRichNmeaLine(withChecksum('GPGSA,A,3,01,02,,,,,,,,,,,1.50,1.00,1.10'));
    applyRichNmeaLine(withChecksum('GPGSV,2,2,05,03,30,060,40'));

    const state = get(gpsSatellites);
    expect(state.assemblies[gsvKey]).toBeUndefined();
    expect(state.constellations[gsvKey]).toMatchObject({
      talkerId: 'GP',
      satellites: [
        { prn: 1, elevationDeg: 10, azimuthDeg: 20, snrDb: 30 },
        { prn: 2, elevationDeg: 20, azimuthDeg: 40, snrDb: 35 },
        { prn: 3, elevationDeg: 30, azimuthDeg: 60, snrDb: 40 },
      ],
    });
    expect(state.gsaByKey[gsaKeyForGp]).toMatchObject({
      talkerId: 'GP',
      systemId: null,
      fixType: 3,
      usedPrns: [1, 2],
    });
  });
});

describe('resetGpsSatellites', () => {
  it('clears the store back to initialSatellitesState', () => {
    applyRichNmeaLine(withChecksum('GPGSV,1,1,02,01,10,020,30,02,20,040,35'));
    expect(get(gpsSatellites)).not.toEqual(initialSatellitesState);

    resetGpsSatellites();
    expect(get(gpsSatellites)).toEqual(initialSatellitesState);
  });

  it('clears both constellations and gsaByKey', () => {
    applyRichNmeaLine(withChecksum('GPGSV,1,1,02,01,10,020,30,02,20,040,35'));
    applyRichNmeaLine(withChecksum('GNGSA,A,3,18,20,21,26,,,,,,,,,1.94,1.18,1.54,1'));
    const before = get(gpsSatellites);
    expect(Object.keys(before.constellations).length).toBeGreaterThan(0);
    expect(Object.keys(before.gsaByKey).length).toBeGreaterThan(0);

    resetGpsSatellites();
    const after = get(gpsSatellites);
    expect(after.constellations).toEqual({});
    expect(after.gsaByKey).toEqual({});
  });
});
