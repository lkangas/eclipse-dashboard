// Pure helpers behind the GPS gear-icon popover (GpsPanel.svelte) -- the
// raw-NMEA-stream ring buffer and the port-list label formatter. DOM/
// navigator-free by design, same testable-without-a-real-device shape as
// nmea.ts/nmeaFix.ts; connection.ts (the real navigator.serial glue)
// calls into these rather than reimplementing them inline, keeping its
// own untested surface as thin as its own comment already promises.

/** Appends one line to a fixed-capacity ring buffer (oldest dropped
 * first), for the raw NMEA stream monitor. Every line goes in here
 * regardless of whether it parsed as a known sentence -- garbled bytes
 * from a wrong baud-rate guess are exactly the kind of thing this
 * monitor exists to surface, not just the sentences the app understands. */
export function appendLine(buffer: readonly string[], line: string, capacity: number): string[] {
  const next = buffer.length >= capacity ? buffer.slice(buffer.length - capacity + 1) : buffer.slice();
  next.push(line);
  return next;
}

/** A minimal structural subset of Web Serial's SerialPort -- just enough
 * to label a port in the gear dropdown's port list. Matches the real
 * SerialPort type (web-serial.d.ts) structurally without importing it,
 * so this stays plain-TS testable against a fake object. */
export interface PortLike {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

/** Web Serial deliberately never exposes an OS device name or COM-port
 * string (a privacy boundary in the spec itself) -- USB vendor/product
 * ID is the most specific label a page can ever get. Falls back to a
 * generic label for the rare port that reports neither (e.g. a real
 * non-USB serial port). */
export function describePort(port: PortLike): string {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === undefined || usbProductId === undefined) return 'Serial port';
  const vid = usbVendorId.toString(16).padStart(4, '0');
  const pid = usbProductId.toString(16).padStart(4, '0');
  return `USB ${vid}:${pid}`;
}
