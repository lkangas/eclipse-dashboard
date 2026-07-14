import { describe, expect, it } from 'vitest';
import { parseRichNmeaSentence, type FullGsaSentence, type GsvSentence } from './nmeaRich';
import {
  applyGsaSentence,
  applyGsvSentence,
  findMatchingGsa,
  gsaKey,
  initialSatellitesState,
  isStale,
  satelliteGroupKey,
  STALE_CONSTELLATION_MS,
  withUsedInFix,
  type GsaInfo,
  type SatelliteInView,
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
  // parseRichNmeaSentence's return type now also includes full-GSA
  // (PLAN.md §6 phase 2) -- this helper only ever feeds hand-built GSV
  // lines, so a non-GSV result here means the fixture itself is wrong.
  if (result.type !== 'GSV') throw new Error(`test fixture did not parse as GSV: ${line}`);
  return result;
}

function gsa(line: string): FullGsaSentence {
  const result = parseRichNmeaSentence(withChecksum(line));
  if (!result) throw new Error(`test fixture failed to parse: ${line}`);
  if (result.type !== 'GSA') throw new Error(`test fixture did not parse as GSA: ${line}`);
  return result;
}

// Builds a full-GSA sentence body (without address/checksum) from named
// parts instead of hand-counting commas across GSA's 12 fixed empty-able
// SV sub-fields -- easy to get wrong by eye when the PRN count varies
// between fixtures (see nmeaRich.ts's parseGsa() for the exact field
// layout this mirrors: Mode1, Mode2, SV1..SV12, PDOP, HDOP, VDOP, and an
// optional trailing System ID).
function gsaLine(params: {
  talkerId: string;
  fixType: number;
  prns: number[];
  pdop: number;
  hdop: number;
  vdop: number;
  systemId?: string;
}): string {
  const svFields = new Array(12).fill('');
  params.prns.forEach((prn, i) => {
    svFields[i] = String(prn);
  });
  const fields = [
    `${params.talkerId}GSA`,
    'A',
    String(params.fixType),
    ...svFields,
    String(params.pdop),
    String(params.hdop),
    String(params.vdop),
  ];
  if (params.systemId !== undefined) fields.push(params.systemId);
  return fields.join(',');
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
    state = applyGsvSentence(state, gsv('GPGSV,3,1,09,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'), 0);
    state = applyGsvSentence(
      state,
      gsv('GPGSV,3,2,09,05,50,100,50,06,60,120,55,07,70,140,60,08,80,160,00'),
      100,
    );
    state = applyGsvSentence(state, gsv('GPGSV,3,3,09,09,90,180,20'), 200);

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
      lastUpdatedMs: 200,
    });
  });

  it('never publishes for an epoch with a dropped middle message, and does not corrupt the next epoch', () => {
    let state = initialSatellitesState;
    const key = satelliteGroupKey('GP', null);

    // Epoch 1: msgNum 1 and 3 arrive, msgNum 2 is dropped.
    state = applyGsvSentence(state, gsv('GPGSV,3,1,09,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'), 0);
    state = applyGsvSentence(state, gsv('GPGSV,3,3,09,09,90,180,20'), 100);
    expect(state.constellations[key]).toBeUndefined();
    expect(state.assemblies[key]?.slots[1]).toBeUndefined(); // msgNum 2's slot

    // Epoch 2: a fresh msgNum===1 supersedes the stale incomplete buffer
    // and completes normally. (Well within STALE_ASSEMBLY_MS too, so this
    // exercises the msgNum===1 reset path specifically, not the staleness
    // one.)
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,11,11,011,11,12,12,012,12'), 200);
    state = applyGsvSentence(state, gsv('GPGSV,2,2,05,13,13,013,13'), 300);

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
      lastUpdatedMs: 300,
    });
  });

  it('leaves constellations at the previous complete group when a later epoch drops a message', () => {
    let state = initialSatellitesState;
    const key = satelliteGroupKey('GP', null);

    // Epoch 1 completes cleanly.
    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,30,02,20,040,35'), 0);
    const firstComplete = state.constellations[key];
    expect(firstComplete).toBeDefined();

    // Epoch 2: msgNum 1 starts a fresh 2-message run, but msgNum 2 never
    // arrives -- constellations should still show epoch 1's group.
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,11,11,011,11,12,12,012,12'), 100);
    expect(state.constellations[key]).toBe(firstComplete);
    expect(state.assemblies[key]).toBeDefined();
  });

  it('assembles two different constellations independently without cross-contamination', () => {
    let state = initialSatellitesState;
    const gpKey = satelliteGroupKey('GP', null);
    const glKey = satelliteGroupKey('GL', null);

    // Interleaved sentence-by-sentence.
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,01,10,020,30,02,20,040,35'), 0);
    state = applyGsvSentence(state, gsv('GLGSV,2,1,05,65,15,025,25,66,25,045,26'), 50);
    state = applyGsvSentence(state, gsv('GPGSV,2,2,05,03,30,060,40'), 100);
    state = applyGsvSentence(state, gsv('GLGSV,2,2,05,67,35,065,27'), 150);

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

    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,30,02,20,040,35,1'), 0);
    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,44,02,20,040,46,6'), 50);

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
    state = applyGsvSentence(state, gsv('GAGSV,1,1,02,301,45,090,40,302,50,100,42'), 0);

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
      lastUpdatedMs: 0,
    });
  });

  it('does not mutate the previous state object passed in', () => {
    const before: SatellitesState = initialSatellitesState;
    // structuredClone, not JSON.parse(JSON.stringify(...)) -- the latter
    // turns array holes/undefined elements into null, which would make
    // this snapshot itself wrong for the slots arrays involved here.
    const beforeSnapshot = structuredClone(before);

    applyGsvSentence(before, gsv('GPGSV,2,1,05,01,10,020,30,02,20,040,35'), 0);

    expect(before).toEqual(beforeSnapshot);
    expect(before.assemblies).toEqual({});
    expect(before.constellations).toEqual({});
  });

  it('does not mutate an in-progress state object when folding in the next sentence', () => {
    let state = initialSatellitesState;
    state = applyGsvSentence(state, gsv('GPGSV,2,1,05,01,10,020,30,02,20,040,35'), 0);
    const midEpochSnapshot = structuredClone(state);

    applyGsvSentence(state, gsv('GPGSV,2,2,05,03,30,060,40'), 100);

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
    expect(applyGsvSentence(state, malformed, 0)).toBe(state);
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
    expect(applyGsvSentence(state, malformed, 0)).toBe(state);
  });

  it('does not splice slots from two different epochs when a constellation drops msgNum===1 in two consecutive epochs (regression)', () => {
    let state = initialSatellitesState;
    const key = satelliteGroupKey('GP', null);

    // Epoch A (totalMsgs=3): msgNum=1 arrives, msgNum=2 is dropped, msgNum=3
    // arrives -- an incomplete [A1, undefined, A3] assembly is left behind.
    state = applyGsvSentence(state, gsv('GPGSV,3,1,09,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'), 0);
    state = applyGsvSentence(state, gsv('GPGSV,3,3,09,09,90,180,20'), 100);
    expect(state.constellations[key]).toBeUndefined();
    expect(state.assemblies[key]?.slots[0]).toBeDefined(); // A1
    expect(state.assemblies[key]?.slots[1]).toBeUndefined(); // dropped
    expect(state.assemblies[key]?.slots[2]).toBeDefined(); // A3

    // Epoch B (totalMsgs=3, msgNum=1 ALSO dropped this epoch): msgNum=2
    // arrives more than STALE_ASSEMBLY_MS after epoch A's last slot. Without
    // the staleness check this would fold into slot 1 of the stale [A1,
    // undefined, A3] buffer, making all three slots defined and (wrongly)
    // publishing a constellation spliced from epoch A's messages 1+3 and
    // epoch B's message 2.
    state = applyGsvSentence(
      state,
      gsv('GPGSV,3,2,09,15,15,015,15,16,16,016,16,17,17,017,17'),
      100 + 3001,
    );

    // Must NOT have "completed" from the spliced slots.
    expect(state.constellations[key]).toBeUndefined();
    // The stale assembly must have been discarded wholesale -- epoch A's
    // slots 0 and 2 are gone, only epoch B's fresh msgNum=2 slot remains.
    expect(state.assemblies[key]?.slots[0]).toBeUndefined();
    expect(state.assemblies[key]?.slots[2]).toBeUndefined();
    expect(state.assemblies[key]?.slots[1]).toBeDefined();
    expect(state.assemblies[key]?.slots[1]?.[0]).toMatchObject({ prn: 15 });
  });

  it('does not spuriously reset on a short real-world gap between messages of the same epoch', () => {
    let state = initialSatellitesState;
    const key = satelliteGroupKey('GP', null);

    // Realistic tens-to-low-hundreds-of-ms gaps between sentences of one
    // burst -- comfortably under STALE_ASSEMBLY_MS -- must not be treated
    // as staleness and must still complete normally.
    state = applyGsvSentence(state, gsv('GPGSV,3,1,09,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'), 0);
    state = applyGsvSentence(
      state,
      gsv('GPGSV,3,2,09,05,50,100,50,06,60,120,55,07,70,140,60,08,80,160,00'),
      180,
    );
    state = applyGsvSentence(state, gsv('GPGSV,3,3,09,09,90,180,20'), 340);

    expect(state.assemblies[key]).toBeUndefined();
    expect(state.constellations[key]?.satellites).toHaveLength(9);
  });
});

describe('gsaKey', () => {
  it('combines talkerId and systemId', () => {
    expect(gsaKey('GN', '1')).toBe('GN:1');
  });

  it('treats a null systemId as its own bucket', () => {
    expect(gsaKey('GP', null)).toBe('GP:');
  });
});

describe('applyGsaSentence', () => {
  it('stores a GsaInfo keyed by talkerId+systemId', () => {
    const state = applyGsaSentence(
      initialSatellitesState,
      gsa('GNGSA,A,3,18,20,21,26,,,,,,,,,1.94,1.18,1.54,1'),
      1000,
    );

    const key = gsaKey('GN', '1');
    expect(state.gsaByKey[key]).toEqual({
      key,
      talkerId: 'GN',
      systemId: '1',
      fixType: 3,
      usedPrns: [18, 20, 21, 26],
      pdop: 1.94,
      hdop: 1.18,
      vdop: 1.54,
      possiblyMixed: false, // systemId is present ('1'), not the ambiguous shape
      lastUpdatedMs: 1000,
    });
  });

  it('updates in place when a second GSA arrives with the same key, stamping the newer timestamp', () => {
    let state = applyGsaSentence(
      initialSatellitesState,
      gsa('GNGSA,A,3,18,20,21,26,,,,,,,,,1.94,1.18,1.54,1'),
      1000,
    );
    state = applyGsaSentence(state, gsa('GNGSA,A,2,18,20,,,,,,,,,,,2.50,2.00,1.50,1'), 2000);

    const key = gsaKey('GN', '1');
    expect(state.gsaByKey[key]).toMatchObject({
      fixType: 2,
      usedPrns: [18, 20],
      pdop: 2.5,
      hdop: 2.0,
      vdop: 1.5,
      lastUpdatedMs: 2000,
    });
    expect(Object.keys(state.gsaByKey)).toHaveLength(1);
  });

  it('keeps different keys from colliding', () => {
    let state = applyGsaSentence(
      initialSatellitesState,
      gsa('GNGSA,A,3,18,20,21,26,,,,,,,,,1.94,1.18,1.54,1'),
      1000,
    );
    state = applyGsaSentence(state, gsa('GNGSA,A,3,301,302,,,,,,,,,,,8.21,5.24,6.32,3'), 1000);

    const gpsKey = gsaKey('GN', '1');
    const galileoKey = gsaKey('GN', '3');
    expect(state.gsaByKey[gpsKey]).toMatchObject({ usedPrns: [18, 20, 21, 26] });
    expect(state.gsaByKey[galileoKey]).toMatchObject({ usedPrns: [301, 302] });
    expect(Object.keys(state.gsaByKey)).toHaveLength(2);
  });

  it('does not mutate the previous state object passed in', () => {
    const before: SatellitesState = initialSatellitesState;
    const beforeSnapshot = structuredClone(before);

    applyGsaSentence(before, gsa('GNGSA,A,3,18,20,21,26,,,,,,,,,1.94,1.18,1.54,1'), 1000);

    expect(before).toEqual(beforeSnapshot);
    expect(before.gsaByKey).toEqual({});
  });

  // Confirmed-bug regression: a receiver that shares the 'GN' talker AND
  // omits System ID on two DIFFERENT physical constellations collapses
  // both onto gsaKey's same 'GN:' string key. Before this fix, the second
  // arrival's plain-replace upsert silently discarded the first arrival's
  // entire usedPrns list. Now this specific (talkerId==='GN' &&
  // systemId===null) shape is flagged possiblyMixed, and usedPrns unions
  // instead of replacing, so both constellations' used-PRN data survives.
  it('unions usedPrns and sets possiblyMixed when two GN GSAs both omit systemId (real collision)', () => {
    let state = applyGsaSentence(
      initialSatellitesState,
      gsa(gsaLine({ talkerId: 'GN', fixType: 3, prns: [5, 12], pdop: 1.5, hdop: 1.0, vdop: 1.2 })),
      1000,
    );
    state = applyGsaSentence(
      state,
      gsa(gsaLine({ talkerId: 'GN', fixType: 3, prns: [20, 25], pdop: 2.0, hdop: 1.8, vdop: 1.6 })),
      2000,
    );

    const key = gsaKey('GN', null);
    expect(Object.keys(state.gsaByKey)).toHaveLength(1); // still collapsed onto one key
    expect(state.gsaByKey[key].possiblyMixed).toBe(true);
    expect(state.gsaByKey[key].usedPrns.slice().sort((a, b) => a - b)).toEqual([5, 12, 20, 25]);
    // Scalars are last-write-wins even in the ambiguous case -- only
    // usedPrns accumulates (see applyGsaSentence's own comment).
    expect(state.gsaByKey[key].pdop).toBe(2.0);
    expect(state.gsaByKey[key].hdop).toBe(1.8);
    expect(state.gsaByKey[key].vdop).toBe(1.6);
  });

  // Non-ambiguous control case: an ordinary per-constellation-talker
  // receiver (e.g. 'GP') that simply doesn't emit System ID at all. There
  // is only ever one real constellation behind a 'GP' talker, so a second
  // GSA arriving under the same key is that same constellation reporting
  // again -- plain replace remains correct, and possiblyMixed must stay
  // false (must not regress into unioning here).
  it('still does a plain replace (not union) and possiblyMixed stays false for an ordinary talkerId with no systemId', () => {
    let state = applyGsaSentence(
      initialSatellitesState,
      gsa(gsaLine({ talkerId: 'GP', fixType: 3, prns: [1, 2], pdop: 1.0, hdop: 1.0, vdop: 1.0 })),
      1000,
    );
    state = applyGsaSentence(
      state,
      gsa(gsaLine({ talkerId: 'GP', fixType: 3, prns: [3, 4], pdop: 2.0, hdop: 2.0, vdop: 2.0 })),
      2000,
    );

    const key = gsaKey('GP', null);
    expect(state.gsaByKey[key].possiblyMixed).toBe(false);
    expect(state.gsaByKey[key].usedPrns).toEqual([3, 4]); // replaced, not unioned with [1, 2]
  });
});

describe('withUsedInFix', () => {
  const satellites: SatelliteInView[] = [
    { prn: 18, elevationDeg: 45, azimuthDeg: 90, snrDb: 40 },
    { prn: 20, elevationDeg: 50, azimuthDeg: 100, snrDb: 42 },
    { prn: 21, elevationDeg: 30, azimuthDeg: 200, snrDb: 25 },
  ];

  it('flags satellites whose PRN is in the used list and leaves others false', () => {
    expect(withUsedInFix(satellites, [18, 21])).toEqual([
      { prn: 18, elevationDeg: 45, azimuthDeg: 90, snrDb: 40, usedInFix: true },
      { prn: 20, elevationDeg: 50, azimuthDeg: 100, snrDb: 42, usedInFix: false },
      { prn: 21, elevationDeg: 30, azimuthDeg: 200, snrDb: 25, usedInFix: true },
    ]);
  });

  it('flags nothing when the used list is empty', () => {
    const result = withUsedInFix(satellites, []);
    expect(result.every((s) => s.usedInFix === false)).toBe(true);
  });

  it('does not mutate its input', () => {
    const satellitesSnapshot = structuredClone(satellites);
    withUsedInFix(satellites, [18]);
    expect(satellites).toEqual(satellitesSnapshot);
  });
});

describe('findMatchingGsa', () => {
  it('matches directly via talkerId (e.g. a GPGSV against a GPGSA)', () => {
    const gpGsa: GsaInfo = {
      key: gsaKey('GP', null),
      talkerId: 'GP',
      systemId: null,
      fixType: 3,
      usedPrns: [18, 20],
      pdop: 1.94,
      hdop: 1.18,
      vdop: 1.54,
      possiblyMixed: false, // talkerId is 'GP', not 'GN' -- not the ambiguous shape
      lastUpdatedMs: 1000,
    };
    const gsaByKey: Record<string, GsaInfo> = { [gpGsa.key]: gpGsa };

    expect(findMatchingGsa(gsaByKey, 'GP')).toBe(gpGsa);
  });

  it('matches a shared-talker GNGSA against a GPGSV via System ID', () => {
    const gnGsa: GsaInfo = {
      key: gsaKey('GN', '1'),
      talkerId: 'GN',
      systemId: '1', // describeSystemId('1') === 'GPS'
      fixType: 3,
      usedPrns: [18, 20],
      pdop: 8.21,
      hdop: 5.24,
      vdop: 6.32,
      possiblyMixed: false, // systemId is present -- not the ambiguous shape
      lastUpdatedMs: 1000,
    };
    const gsaByKey: Record<string, GsaInfo> = { [gnGsa.key]: gnGsa };

    // describeConstellation('GP') === 'GPS' === describeSystemId('1')
    expect(findMatchingGsa(gsaByKey, 'GP')).toBe(gnGsa);
  });

  it('returns null when neither strategy applies (shared talker, no System ID)', () => {
    const gnGsa: GsaInfo = {
      key: gsaKey('GN', null),
      talkerId: 'GN',
      systemId: null,
      fixType: 3,
      usedPrns: [65, 66],
      pdop: 1.94,
      hdop: 1.18,
      vdop: 1.54,
      possiblyMixed: true, // exactly the ambiguous shape -- talkerId 'GN', no systemId
      lastUpdatedMs: 1000,
    };
    const gsaByKey: Record<string, GsaInfo> = { [gnGsa.key]: gnGsa };

    // 'GN' !== 'GL' (no direct match), and there's no systemId to fall
    // back on -- this is the documented gap (PLAN.md §4 item 3), not a bug.
    expect(findMatchingGsa(gsaByKey, 'GL')).toBeNull();
  });

  it('returns null when gsaByKey is empty', () => {
    expect(findMatchingGsa({}, 'GP')).toBeNull();
  });

  it('does not false-match on two different unmapped values that would collide under an identical fallback template', () => {
    // Regression test: describeSystemId and describeConstellation used to
    // share the literal `Unknown (${x})` fallback, so a GSA with a
    // non-conforming System ID whose raw text happened to equal an
    // unmapped GSV talkerId's raw text (both 'XX' here) would produce the
    // same label from both helpers and be wrongly treated as a match.
    // Now that each fallback is structurally distinct
    // (`Unknown talker (...)` vs `Unknown systemId (...)`), this must
    // return null instead of pairing unrelated constellations.
    const gnGsa: GsaInfo = {
      key: gsaKey('GN', 'XX'),
      talkerId: 'GN',
      systemId: 'XX',
      fixType: 3,
      usedPrns: [1, 2],
      pdop: 1.94,
      hdop: 1.18,
      vdop: 1.54,
      possiblyMixed: false, // systemId is present ('XX') -- not the ambiguous shape
      lastUpdatedMs: 1000,
    };
    const gsaByKey: Record<string, GsaInfo> = { [gnGsa.key]: gnGsa };

    expect(findMatchingGsa(gsaByKey, 'XX')).toBeNull();
  });
});

describe('isStale', () => {
  it('is not stale exactly at the threshold', () => {
    expect(isStale(1000, 1000 + STALE_CONSTELLATION_MS)).toBe(false);
  });

  it('is stale just past the threshold', () => {
    expect(isStale(1000, 1000 + STALE_CONSTELLATION_MS + 1)).toBe(true);
  });

  it('is not stale for a recent update', () => {
    expect(isStale(1000, 1500)).toBe(false);
  });

  it('is not stale when lastUpdatedMs is in the future (clock skew defensiveness)', () => {
    expect(isStale(2000, 1000)).toBe(false);
  });
});

describe('applyGsvSentence / applyGsaSentence staleness stamping (PLAN.md §6 phase 4)', () => {
  it('stamps a completed GSV group with the nowMs of its completing sentence', () => {
    let state = initialSatellitesState;
    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,30,02,20,040,35'), 5000);

    const key = satelliteGroupKey('GP', null);
    expect(state.constellations[key].lastUpdatedMs).toBe(5000);
  });

  it('bumps lastUpdatedMs forward each time a constellation completes a fresh run', () => {
    let state = initialSatellitesState;
    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,30,02,20,040,35'), 5000);
    state = applyGsvSentence(state, gsv('GPGSV,1,1,02,01,10,020,30,02,20,040,35'), 8000);

    const key = satelliteGroupKey('GP', null);
    expect(state.constellations[key].lastUpdatedMs).toBe(8000);
  });

  it('does NOT bump lastUpdatedMs while a run is still incomplete -- only a completed group is stamped', () => {
    let state = initialSatellitesState;
    // 5 satellites total, non-last message carries 4 (the NMEA GSV
    // convention this file's own parser assumes -- see nmeaRich.ts's
    // expectedSatCount comment), last message carries the 1 remaining.
    state = applyGsvSentence(
      state,
      gsv('GPGSV,2,1,05,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45'),
      5000,
    );
    // Not complete yet at 5000 -- msgNum 2 hasn't landed.
    const key = satelliteGroupKey('GP', null);
    expect(state.constellations[key]).toBeUndefined();
    state = applyGsvSentence(state, gsv('GPGSV,2,2,05,05,50,100,50'), 8000);
    expect(state.constellations[key].lastUpdatedMs).toBe(8000);
  });

  it('stamps a GSA entry with the nowMs it was applied at', () => {
    let state = initialSatellitesState;
    state = applyGsaSentence(state, gsa('GPGSA,A,3,18,20,,,,,,,,,,,1.50,1.00,1.10'), 5000);

    const key = gsaKey('GP', null);
    expect(state.gsaByKey[key].lastUpdatedMs).toBe(5000);
  });
});
