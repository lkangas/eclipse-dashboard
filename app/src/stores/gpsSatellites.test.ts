// Unlike connection.ts (untested by design -- see its own comment), this
// module has no navigator.serial dependency, so it's exercised for real
// here: raw NMEA-line strings in, gpsSatellites store state out. Mirrors
// nmeaSatellites.test.ts's own multi-constellation/gap-handling cases,
// but through this module's raw-line entry point (applyRichNmeaLine)
// rather than by calling the reducer directly -- this module's whole job
// is that raw-line-in path, so the tests should exercise it.
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { satelliteGroupKey, initialSatellitesState } from '../serial/nmeaSatellites';
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
});

describe('resetGpsSatellites', () => {
  it('clears the store back to initialSatellitesState', () => {
    applyRichNmeaLine(withChecksum('GPGSV,1,1,02,01,10,020,30,02,20,040,35'));
    expect(get(gpsSatellites)).not.toEqual(initialSatellitesState);

    resetGpsSatellites();
    expect(get(gpsSatellites)).toEqual(initialSatellitesState);
  });
});
