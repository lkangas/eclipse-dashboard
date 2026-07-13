import { describe, expect, it } from 'vitest';
import { parseNmeaSentence } from './nmea';

// Appends a correct checksum to a hand-built sentence body (everything
// between '$' and '*') -- lets most cases below construct arbitrary
// field combinations without hand-computing/guessing hex checksums,
// while the two "known-good" cases further down use published
// real-world sentences (Wikipedia's NMEA 0183 examples) with their own
// independently-known checksums as an external sanity check on top.
function withChecksum(body: string): string {
  let checksum = 0;
  for (let i = 0; i < body.length; i++) checksum ^= body.charCodeAt(i);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}

describe('parseNmeaSentence', () => {
  it('parses a well-known GGA example (published checksum)', () => {
    const result = parseNmeaSentence('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47');
    expect(result).toEqual({
      type: 'GGA',
      timeOfDay: { hours: 12, minutes: 35, seconds: 19 },
      lat: 48 + 7.038 / 60,
      lon: 11 + 31.0 / 60,
      fixQuality: 1,
      numSatellites: 8,
      hdop: 0.9,
      altitudeM: 545.4,
    });
  });

  it('parses a well-known RMC example (published checksum)', () => {
    const result = parseNmeaSentence('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A');
    // date asserted separately below -- this example predates the app's
    // fixed 2000+yy pivot (see parseDdmmyy), so its own '94' means 1994,
    // not what this app's simplified rule would give it.
    expect(result).toMatchObject({
      type: 'RMC',
      timeOfDay: { hours: 12, minutes: 35, seconds: 19 },
      status: 'A',
      lat: 48 + 7.038 / 60,
      lon: 11 + 31.0 / 60,
    });
  });

  it('expands a 2-digit year via the fixed 2000+yy pivot (e.g. eclipse day itself)', () => {
    const result = parseNmeaSentence(withChecksum('GPRMC,000000,A,4000.000,N,00300.000,E,,,120826,,,A'));
    expect(result).toMatchObject({ date: { day: 12, month: 8, year: 2026 } });
  });

  it('applies southern/western hemispheres as negative', () => {
    const result = parseNmeaSentence(withChecksum('GPGGA,000000,3403.500,S,05812.250,W,1,04,1.2,120.0,M,,,,'));
    expect(result).toMatchObject({ lat: -(34 + 3.5 / 60), lon: -(58 + 12.25 / 60) });
  });

  it('reports fixQuality 0 (no fix) with a still-parseable lat/lon field', () => {
    const result = parseNmeaSentence(withChecksum('GPGGA,120000,4000.000,N,00300.000,E,0,00,99.9,,M,,,,'));
    expect(result).toMatchObject({ type: 'GGA', fixQuality: 0, numSatellites: 0, altitudeM: null });
  });

  it('reports RMC status V (void) as a valid sentence, not a parse failure', () => {
    const result = parseNmeaSentence(withChecksum('GPRMC,120000,V,,,,,,,120126,,,N'));
    expect(result).toMatchObject({ type: 'RMC', status: 'V', lat: null, lon: null });
  });

  it('ignores the talker ID -- GN (multi-constellation) parses the same as GP', () => {
    const result = parseNmeaSentence(withChecksum('GNGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'));
    expect(result).toMatchObject({ type: 'GGA', fixQuality: 1 });
  });

  it('rejects a bad checksum', () => {
    expect(parseNmeaSentence('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*00')).toBeNull();
  });

  it('rejects sentence types this app has no use for (e.g. GSA)', () => {
    expect(parseNmeaSentence(withChecksum('GPGSA,A,3,04,05,,,,,,,,,,,2.5,1.3,2.1'))).toBeNull();
  });

  it('rejects garbage that is not an NMEA sentence at all', () => {
    expect(parseNmeaSentence('not a sentence')).toBeNull();
    expect(parseNmeaSentence('')).toBeNull();
  });

  it('trims a trailing CR left over from CRLF line-splitting', () => {
    const result = parseNmeaSentence(withChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,') + '\r');
    expect(result).toMatchObject({ type: 'GGA', fixQuality: 1 });
  });
});
