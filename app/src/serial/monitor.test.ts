import { describe, expect, it } from 'vitest';
import { appendLine, describePort } from './monitor';

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
