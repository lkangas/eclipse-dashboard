// Pure helpers behind the GPS UI (GpsRibbon.svelte, GpsMonitorPanel.svelte)
// -- the raw-NMEA-stream ring buffer, the port-list label formatter, the
// epoch-rate tracker, and the GGA fix-quality/GSA fix-type labels. DOM/
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

/** One "live rows" display slot -- see `applyLineToRows` below. */
export interface LiveRow {
  key: string; // display key, e.g. "GNGGA #1" or "GNGSA #2"
  address: string; // raw sentence address, e.g. "GNGSA" (talkerId+sentenceId, no '$')
  line: string; // the latest raw line for this slot
}

/** Accumulated state for the "live rows" raw-stream display mode --
 * PLAN.md §10's addendum. `epochCounts` resets on every GGA arrival (the
 * same once-per-epoch boundary the Hz tracker above already relies on);
 * `order` and `rows` persist across epochs so a row's position never
 * moves once assigned. */
export interface LiveRowsState {
  epochCounts: Record<string, number>; // address -> occurrences seen since the last GGA (epoch boundary)
  order: string[]; // first-seen key order, so rows don't reshuffle position across renders
  rows: Record<string, LiveRow>;
}

export const initialLiveRowsState: LiveRowsState = { epochCounts: {}, order: [], rows: {} };

/** Folds one raw line into the "live rows" state: one row per distinct
 * sentence identity (address + per-epoch recurrence ordinal), updating
 * in place instead of appending -- a legible alternative to the
 * scrolling `appendLine` view above at a high fix rate (PLAN.md §10).
 *
 * Same "raw stream display" reasoning as `appendLine`: no checksum
 * validation, no rejecting malformed lines -- garbled bytes from a wrong
 * baud-rate guess are exactly what this monitor exists to surface. A
 * line with no usable content still gets its own address (falling back
 * to the trimmed text itself, or '?' for a genuinely empty line) so
 * garbage always gets a row rather than being dropped or throwing. */
export function applyLineToRows(state: LiveRowsState, rawLine: string): LiveRowsState {
  const trimmed = rawLine.trim();
  const withoutDollar = trimmed.startsWith('$') ? trimmed.slice(1) : trimmed;
  const commaIdx = withoutDollar.indexOf(',');
  const rawAddress = commaIdx >= 0 ? withoutDollar.slice(0, commaIdx) : withoutDollar;
  const address = rawAddress.length > 0 ? rawAddress : '?';

  // GGA marks the epoch boundary -- reset before processing this line so
  // the GGA itself is the new epoch's first occurrence, not the previous
  // epoch's last (same convention as PLAN.md §10 and nmea.ts's own
  // last-3-letters sentence-type check).
  const epochCounts = address.endsWith('GGA') ? {} : state.epochCounts;

  const count = (epochCounts[address] ?? 0) + 1;
  const key = `${address} #${count}`;

  const order = state.order.includes(key) ? state.order : [...state.order, key];

  return {
    epochCounts: { ...epochCounts, [address]: count },
    order,
    rows: { ...state.rows, [key]: { key, address, line: rawLine } },
  };
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

// Generous ceiling on the computed rate -- real GNSS receivers top out
// well under this even at their fastest configurable output rate. Only
// exists to catch a timing artifact, not a real device: if the read
// loop stalls (e.g. GC pause) and then drains several already-buffered
// GGA lines from genuinely different epochs in one synchronous burst,
// their Date.now() timestamps land within ~0-1ms of each other,
// producing a momentary nonsense spike (hundreds/thousands of "Hz")
// until real-time samples dilute the window back to normal a couple
// seconds later. Clamping means the monitor shows a plausible-if-wrong
// number for that brief window instead of an obviously-broken one.
const MAX_PLAUSIBLE_HZ = 25;

/** Rolling epoch-rate tracker for the GPS monitor's Hz readout/pulse
 * (direct request -- "readily indicates visually whether my gps is in
 * 1hz or 10hz mode"). Averaged over a trailing window rather than the
 * gap between the last two arrivals alone, so the number settles
 * quickly without jittering sample-to-sample on ordinary epoch-to-epoch
 * timing noise. Pure: connection.ts owns the timestamps array and
 * Date.now(), passing both in and storing the returned array back --
 * feed it every GGA arrival (the standard once-per-epoch position
 * sentence), not every raw line, since a receiver emits several
 * sentence types per epoch regardless of its configured fix rate. */
export function recordFixEvent(
  timestamps: readonly number[],
  nowMs: number,
  windowMs: number,
): { timestamps: number[]; hz: number | null } {
  const kept = [...timestamps, nowMs].filter((t) => t > nowMs - windowMs);
  if (kept.length < 2) return { timestamps: kept, hz: null };
  const spanS = (kept[kept.length - 1] - kept[0]) / 1000;
  const hz = spanS > 0 ? (kept.length - 1) / spanS : null;
  return { timestamps: kept, hz: hz === null ? null : Math.min(hz, MAX_PLAUSIBLE_HZ) };
}

const FIX_QUALITY_LABELS: Record<number, string> = {
  0: 'Invalid',
  1: 'GPS',
  2: 'DGPS',
  3: 'PPS',
  4: 'RTK fixed',
  5: 'RTK float',
  6: 'Estimated',
};

/** NMEA GGA's fix-quality code (field 6) as a short human label -- the
 * standard NMEA 0183 codes (0=invalid through 6=dead-reckoning
 * estimate; a couple of rarer receiver-specific codes above 6 exist but
 * aren't worth special-casing here). */
export function describeFixQuality(quality: number): string {
  return FIX_QUALITY_LABELS[quality] ?? `Unknown (${quality})`;
}

const FIX_TYPE_LABELS: Record<number, string> = {
  1: 'No fix',
  2: '2D',
  3: '3D',
};

/** NMEA GSA's fix-type code (Mode 2 field) -- 1=no fix, 2=2D (no
 * reliable altitude), 3=3D. Null (not just an unrecognized number) is
 * its own case: it means no GSA sentence has been seen yet, which is
 * common -- not every receiver/config emits GSA at all. */
export function describeFixType(fixType: number | null): string {
  if (fixType === null) return '—';
  return FIX_TYPE_LABELS[fixType] ?? `Unknown (${fixType})`;
}

const CONSTELLATION_LABELS: Record<string, string> = {
  GP: 'GPS',
  GL: 'GLONASS',
  GA: 'Galileo',
  GB: 'BeiDou',
  BD: 'BeiDou',
  GQ: 'QZSS',
  GI: 'NavIC',
  GN: 'Multi-GNSS',
};

/** NMEA talker ID (GP/GL/GA/GB/BD/GQ/GI/GN/...) as a short human label,
 * for the rich monitor's per-constellation panels -- the pattern this
 * app's core pipeline (nmea.ts) deliberately ignores, but which the rich
 * parser (nmeaRich.ts) tracks precisely so panels can be split by system. */
export function describeConstellation(talkerId: string): string {
  return CONSTELLATION_LABELS[talkerId] ?? `Unknown (${talkerId})`;
}
