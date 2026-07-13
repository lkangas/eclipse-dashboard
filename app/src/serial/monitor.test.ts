import { describe, expect, it } from 'vitest';
import { appendLine, describeConstellation, describeFixQuality, describeFixType, describePort, recordFixEvent } from './monitor';

describe('appendLine', () => {
  it('appends within capacity', () => {
    expect(appendLine(['a', 'b'], 'c', 5)).toEqual(['a', 'b', 'c']);
  });

  it('drops the oldest line once at capacity', () => {
    expect(appendLine(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('handles a capacity of 1', () => {
    expect(appendLine(['a'], 'b', 1)).toEqual(['b']);
  });

  it('handles an empty buffer', () => {
    expect(appendLine([], 'a', 3)).toEqual(['a']);
  });

  it('does not mutate the input buffer', () => {
    const buf = ['a', 'b'];
    appendLine(buf, 'c', 5);
    expect(buf).toEqual(['a', 'b']);
  });
});

describe('describePort', () => {
  it('formats vendor/product IDs as lowercase hex', () => {
    // The real Silicon Labs CP210x USB-to-UART bridge VID:PID -- a
    // common cheap GPS dongle chipset, and a real-world fixture rather
    // than an arbitrary number.
    expect(describePort({ getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }) })).toBe('USB 10c4:ea60');
  });

  it('pads short hex values to 4 digits', () => {
    expect(describePort({ getInfo: () => ({ usbVendorId: 1, usbProductId: 2 }) })).toBe('USB 0001:0002');
  });

  it('falls back to a generic label when IDs are missing', () => {
    expect(describePort({ getInfo: () => ({}) })).toBe('Serial port');
  });

  it('falls back when only one ID is present', () => {
    expect(describePort({ getInfo: () => ({ usbVendorId: 0x10c4 }) })).toBe('Serial port');
  });
});

describe('recordFixEvent', () => {
  it('reports no rate yet from a single sample', () => {
    const { timestamps, hz } = recordFixEvent([], 1000, 2500);
    expect(timestamps).toEqual([1000]);
    expect(hz).toBeNull();
  });

  it('computes ~1Hz from evenly spaced 1-second arrivals', () => {
    let timestamps: number[] = [];
    let hz: number | null = null;
    for (const t of [0, 1000, 2000, 3000]) {
      ({ timestamps, hz } = recordFixEvent(timestamps, t, 2500));
    }
    expect(hz).toBeCloseTo(1, 5);
  });

  it('computes ~10Hz from evenly spaced 100ms arrivals', () => {
    let timestamps: number[] = [];
    let hz: number | null = null;
    for (let t = 0; t <= 2000; t += 100) {
      ({ timestamps, hz } = recordFixEvent(timestamps, t, 2500));
    }
    expect(hz).toBeCloseTo(10, 1);
  });

  it('drops samples older than the window', () => {
    let timestamps: number[] = [0, 1000, 2000];
    const { timestamps: kept } = recordFixEvent(timestamps, 5000, 2500);
    // only the new sample (5000) survives -- everything else is >2500ms old
    expect(kept).toEqual([5000]);
  });

  it('clamps an implausible spike (e.g. a burst of buffered lines draining in ~0ms)', () => {
    // Two arrivals 1ms apart would compute to 1000Hz -- a real read-loop-
    // stall artifact this clamp exists to catch, not a real device.
    let timestamps: number[] = [];
    let hz: number | null = null;
    ({ timestamps, hz } = recordFixEvent(timestamps, 1000, 2500));
    ({ timestamps, hz } = recordFixEvent(timestamps, 1001, 2500));
    expect(hz).toBe(25);
  });

  it('does not clamp a plausible high rate', () => {
    let timestamps: number[] = [];
    let hz: number | null = null;
    for (let t = 0; t <= 1000; t += 50) {
      // 20Hz -- fast but within a real receiver's range
      ({ timestamps, hz } = recordFixEvent(timestamps, t, 2500));
    }
    expect(hz).toBeCloseTo(20, 1);
  });

  it('does not mutate the input array', () => {
    const timestamps = [0, 1000];
    recordFixEvent(timestamps, 2000, 2500);
    expect(timestamps).toEqual([0, 1000]);
  });
});

describe('describeFixQuality', () => {
  it('labels the standard NMEA GGA fix-quality codes', () => {
    expect(describeFixQuality(0)).toBe('Invalid');
    expect(describeFixQuality(1)).toBe('GPS');
    expect(describeFixQuality(2)).toBe('DGPS');
    expect(describeFixQuality(4)).toBe('RTK fixed');
    expect(describeFixQuality(5)).toBe('RTK float');
  });

  it('falls back for an unrecognized code', () => {
    expect(describeFixQuality(9)).toBe('Unknown (9)');
  });
});

describe('describeFixType', () => {
  it('labels the standard NMEA GSA fix-type codes', () => {
    expect(describeFixType(1)).toBe('No fix');
    expect(describeFixType(2)).toBe('2D');
    expect(describeFixType(3)).toBe('3D');
  });

  it('shows an em dash when no GSA has been seen yet', () => {
    expect(describeFixType(null)).toBe('—');
  });

  it('falls back for an unrecognized code', () => {
    expect(describeFixType(9)).toBe('Unknown (9)');
  });
});

describe('describeConstellation', () => {
  it('labels the standard talker IDs', () => {
    expect(describeConstellation('GP')).toBe('GPS');
    expect(describeConstellation('GL')).toBe('GLONASS');
    expect(describeConstellation('GA')).toBe('Galileo');
    expect(describeConstellation('GB')).toBe('BeiDou');
    expect(describeConstellation('BD')).toBe('BeiDou');
    expect(describeConstellation('GQ')).toBe('QZSS');
    expect(describeConstellation('GI')).toBe('NavIC');
    expect(describeConstellation('GN')).toBe('Multi-GNSS');
  });

  it('falls back for an unrecognized talker ID', () => {
    expect(describeConstellation('ZZ')).toBe('Unknown (ZZ)');
  });
});
