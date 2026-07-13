// Web Serial (https://wicg.github.io/serial/) isn't part of TypeScript's
// built-in DOM lib -- it's Chromium-only and not a W3C standard, so
// lib.dom.d.ts doesn't ship types for it. Hand-rolled here rather than
// pulling in @types/w3c-web-serial: only the small surface connection.ts
// actually uses (requestPort, open/close, the readable/writable
// streams, the connect/disconnect events), not the full spec.

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface Serial extends EventTarget {
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial?: Serial;
}
