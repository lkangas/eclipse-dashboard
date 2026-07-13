import { describe, expect, it } from 'vitest';
import { parseRichNmeaSentence, type GsvSentence } from './nmeaRich';
import {
  applyGsvSentence,
  initialSatellitesState,
  satelliteGroupKey,
  type SatellitesState,
} from './nmeaSatellites';

// Appends a correct checksum to a hand-built sentence body -- mirrors
// nmea.test.ts/nmeaRich.test.ts's own withChecksum helper.
function withChecksum(body: string): string {
  let checksum = 0;
  for (let i = 0; i < body.length; i++) checksum ^= body.charCodeAt(i);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}

function gsv(line: string): GsvSentence {
  const result = parseRichNmeaSentence(withChecksum(line));
  if (!result) throw new Error(`test fixture failed to parse: ${line}`);
  return result;
}

describe('satelliteGroupKey', () => {
  it('combines talkerId and signalId', () => {
    expect(satelliteGroupKey('GP', '1')).toBe('GP:1');
  });

  it('treats a null signalId as its own bucket', () => {
    expect(satelliteGroupKey('GP', null)).toBe('GP:');
  });
});

describe('applyGsvSentence', () => {
  it('publishes one complete constellation after a clean 3-message run, and clears the in-progress assembly', () => {
    let state = initialSatellitesState;
    state = applyGsvSentence(state, gsv('GPGSV,3,1,09,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'));
    state = applyGsvSentence(state, gsv('GPGSV,3,2,09,05,50,100,50,06,60,120,55,07,70,140,60,08,80,160,00'));
    state = applyGsvSentence(state, gsv('GPGSV,3,3,09,09,90,180,20'));

    const key = satelliteGroupKey('GP', null);
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

  it('never publishes for an epoch with a dropped middle message, and does not corrupt the next epoch', () => {
    let state = initialSatellitesState;
    const key = satelliteGroupKey('GP', null);

    // Epoch 1: msgNum 1 and 3 arrive, msgNum 2 is dropped.
    state = applyGsvSentence(state, gsv('GPGSV,3,1,09,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'));
    state = applyGsvSentence(state, gsv('GPGSV,3,3,09,09,90,180,20'));
    expect(state.constellations[key]).toBeUndefined();
    expect(state.assemblies[key]?.slots[1]).toBeUndefined(); // msgNum 2's slot

    // Epoch 2: a fresh msgNum===1 supersedes the stale incomplete buffer
    // and completes normally.
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,11,11,011,11,12,12,012,12'));
    state = applyGsvSentence(state, gsv('GPGSV,2,2,05,13,13,013,13'));

    expect(state.assemblies[key]).toBeUndefined();
    expect(state.constellations[key]).toEqual({
      key,
      talkerId: 'GP',
      signalId: null,
      satellites: [
        { prn: 11, elevationDeg: 11, azimuthDeg: 11, snrDb: 11 },
        { prn: 12, elevationDeg: 12, azimuthDeg: 12, snrDb: 12 },
        { prn: 13, elevationDeg: 13, azimuthDeg: 13, snrDb: 13 },
      ],
    });
  });

  it('leaves constellations at the previous complete group when a later epoch drops a message', () => {
    let state = initialSatellitesState;
    const key = satelliteGroupKey('GP', null);

    // Epoch 1 completes cleanly.
    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,30,02,20,040,35'));
    const firstComplete = state.constellations[key];
    expect(firstComplete).toBeDefined();

    // Epoch 2: msgNum 1 starts a fresh 2-message run, but msgNum 2 never
    // arrives -- constellations should still show epoch 1's group.
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,11,11,011,11,12,12,012,12'));
    expect(state.constellations[key]).toBe(firstComplete);
    expect(state.assemblies[key]).toBeDefined();
  });

  it('assembles two different constellations independently without cross-contamination', () => {
    let state = initialSatellitesState;
    const gpKey = satelliteGroupKey('GP', null);
    const glKey = satelliteGroupKey('GL', null);

    // Interleaved sentence-by-sentence.
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,01,10,020,30,02,20,040,35'));
    state = applyGsvSentence(state, gsv('GLGSV,2,1,05,65,15,025,25,66,25,045,26'));
    state = applyGsvSentence(state, gsv('GPGSV,2,2,05,03,30,060,40'));
    state = applyGsvSentence(state, gsv('GLGSV,2,2,05,67,35,065,27'));

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

  it('keys two signalId runs sharing the same talkerId as independent constellations entries', () => {
    let state = initialSatellitesState;
    const l1Key = satelliteGroupKey('GP', '1');
    const l5Key = satelliteGroupKey('GP', '6');

    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,30,02,20,040,35,1'));
    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,44,02,20,040,46,6'));

    expect(state.constellations[l1Key]).toMatchObject({
      talkerId: 'GP',
      signalId: '1',
      satellites: [
        { prn: 1, elevationDeg: 10, azimuthDeg: 20, snrDb: 30 },
        { prn: 2, elevationDeg: 20, azimuthDeg: 40, snrDb: 35 },
      ],
    });
    expect(state.constellations[l5Key]).toMatchObject({
      talkerId: 'GP',
      signalId: '6',
      satellites: [
        { prn: 1, elevationDeg: 10, azimuthDeg: 20, snrDb: 44 },
        { prn: 2, elevationDeg: 20, azimuthDeg: 40, snrDb: 46 },
      ],
    });
    // Distinct entries, not overwriting each other.
    expect(Object.keys(state.constellations)).toContain(l1Key);
    expect(Object.keys(state.constellations)).toContain(l5Key);
  });

  it('completes immediately for a single-message run with only a couple of satellites', () => {
    let state = initialSatellitesState;
    state = applyGsvSentence(state, gsv('GAGSV,1,1,02,301,45,090,40,302,50,100,42'));

    const key = satelliteGroupKey('GA', null);
    expect(state.assemblies[key]).toBeUndefined();
    expect(state.constellations[key]).toEqual({
      key,
      talkerId: 'GA',
      signalId: null,
      satellites: [
        { prn: 301, elevationDeg: 45, azimuthDeg: 90, snrDb: 40 },
        { prn: 302, elevationDeg: 50, azimuthDeg: 100, snrDb: 42 },
      ],
    });
  });

  it('does not mutate the previous state object passed in', () => {
    const before: SatellitesState = initialSatellitesState;
    // structuredClone, not JSON.parse(JSON.stringify(...)) -- the latter
    // turns array holes/undefined elements into null, which would make
    // this snapshot itself wrong for the slots arrays involved here.
    const beforeSnapshot = structuredClone(before);

    applyGsvSentence(before, gsv('GPGSV,2,1,05,01,10,020,30,02,20,040,35'));

    expect(before).toEqual(beforeSnapshot);
    expect(before.assemblies).toEqual({});
    expect(before.constellations).toEqual({});
  });

  it('does not mutate an in-progress state object when folding in the next sentence', () => {
    let state = initialSatellitesState;
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,01,10,020,30,02,20,040,35'));
    const midEpochSnapshot = structuredClone(state);

    applyGsvSentence(state, gsv('GPGSV,2,2,05,03,30,060,40'));

    expect(state).toEqual(midEpochSnapshot);
  });

  it('ignores a malformed sentence (totalMsgs < 1) as defense in depth', () => {
    const malformed: GsvSentence = {
      type: 'GSV',
      talkerId: 'GP',
      totalMsgs: 0,
      msgNum: 1,
      satellitesInView: 0,
      satellites: [],
      signalId: null,
    };
    const state = initialSatellitesState;
    expect(applyGsvSentence(state, malformed)).toBe(state);
  });

  it('ignores a malformed sentence (msgNum > totalMsgs) as defense in depth', () => {
    const malformed: GsvSentence = {
      type: 'GSV',
      talkerId: 'GP',
      totalMsgs: 2,
      msgNum: 3,
      satellitesInView: 0,
      satellites: [],
      signalId: null,
    };
    const state = initialSatellitesState;
    expect(applyGsvSentence(state, malformed)).toBe(state);
  });
});
