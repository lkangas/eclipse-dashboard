import { describe, expect, it } from 'vitest';
import { parseRichNmeaSentence } from './nmeaRich';

// Appends a correct checksum to a hand-built sentence body (everything
// between '$' and '*') -- mirrors nmea.test.ts's own withChecksum helper,
// so most cases below can construct arbitrary field combinations without
// hand-computing hex checksums, while the "well-known example" case
// further down uses a published real-world sentence (Wikipedia's NMEA
// 0183 GSV example) with its own independently-known checksum as an
// external sanity check on top.
function withChecksum(body: string): string {
  let checksum = 0;
  for (let i = 0; i < body.length; i++) checksum ^= body.charCodeAt(i);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}

describe('parseRichNmeaSentence', () => {
  it('parses a well-known GSV example (published checksum)', () => {
    const result = parseRichNmeaSentence(
      '$GPGSV,3,2,11,14,25,170,00,16,57,208,39,18,67,296,40,19,40,246,00*74',
    );
    expect(result).toEqual({
      type: 'GSV',
      talkerId: 'GP',
      totalMsgs: 3,
      msgNum: 2,
      satellitesInView: 11,
      satellites: [
        { prn: 14, elevationDeg: 25, azimuthDeg: 170, snrDb: 0 },
        { prn: 16, elevationDeg: 57, azimuthDeg: 208, snrDb: 39 },
        { prn: 18, elevationDeg: 67, azimuthDeg: 296, snrDb: 40 },
        { prn: 19, elevationDeg: 40, azimuthDeg: 246, snrDb: 0 },
      ],
      signalId: null,
    });
  });

  it('parses a message with a trailing signal ID field', () => {
    const result = parseRichNmeaSentence(
      withChecksum('GPGSV,1,1,04,01,10,020,30,02,20,040,35,03,30,060,40,04,40,080,45,1'),
    );
    expect(result).toMatchObject({ signalId: '1' });
    expect(result?.satellites).toHaveLength(4);
  });

  it('leaves signalId null when the trailing field is absent', () => {
    const result = parseRichNmeaSentence(
      withChecksum('GPGSV,1,1,02,01,10,020,30,02,20,040,35'),
    );
    expect(result).toMatchObject({ signalId: null });
  });

  it('skips empty-PRN slots in a last message with fewer than 4 satellites', () => {
    // Published example: 11 satellites total, msg 3/3, only 3 slots
    // actually used -- the 4th group is empty-padded ("<empty>,,,").
    const result = parseRichNmeaSentence(
      '$GPGSV,3,3,11,22,42,067,42,24,14,311,43,27,05,244,00,,,,*4D',
    );
    expect(result?.satellites).toEqual([
      { prn: 22, elevationDeg: 42, azimuthDeg: 67, snrDb: 42 },
      { prn: 24, elevationDeg: 14, azimuthDeg: 311, snrDb: 43 },
      { prn: 27, elevationDeg: 5, azimuthDeg: 244, snrDb: 0 },
    ]);
  });

  it('rejects a bad checksum', () => {
    expect(
      parseRichNmeaSentence('$GPGSV,3,2,11,14,25,170,00,16,57,208,39,18,67,296,40,19,40,246,00*00'),
    ).toBeNull();
  });

  it('rejects non-GSV sentence types (e.g. GGA)', () => {
    expect(
      parseRichNmeaSentence(
        withChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'),
      ),
    ).toBeNull();
  });

  it('rejects msgNum > totalMsgs', () => {
    expect(parseRichNmeaSentence(withChecksum('GPGSV,2,3,04,01,10,020,30'))).toBeNull();
  });

  it('rejects msgNum < 1', () => {
    expect(parseRichNmeaSentence(withChecksum('GPGSV,3,0,04,01,10,020,30'))).toBeNull();
  });

  it('rejects totalMsgs < 1', () => {
    expect(parseRichNmeaSentence(withChecksum('GPGSV,0,1,00'))).toBeNull();
  });

  it('parses different talker IDs, each preserving its own talkerId', () => {
    for (const talkerId of ['GP', 'GL', 'GA', 'GB', 'GN']) {
      const result = parseRichNmeaSentence(withChecksum(`${talkerId}GSV,1,1,01,05,20,100,33`));
      expect(result).toMatchObject({ type: 'GSV', talkerId });
    }
  });

  it('trims a trailing CR left over from CRLF line-splitting', () => {
    const result = parseRichNmeaSentence(withChecksum('GPGSV,1,1,01,05,20,100,33') + '\r');
    expect(result).toMatchObject({ talkerId: 'GP', satellites: [{ prn: 5, elevationDeg: 20, azimuthDeg: 100, snrDb: 33 }] });
  });
});
