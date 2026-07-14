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
 * `rows` persists across epochs so a row updates in place rather than
 * being recreated. `order` is NOT first-seen order -- see
 * `sentencePriority` below -- it's recomputed every call so a row's
 * FIXED, priority-based position never depends on which sentence
 * happened to arrive first (direct request: "I need the rows to stay in
 * their fixed places. Example RMC always in the same place."). */
export interface LiveRowsState {
  epochCounts: Record<string, number>; // address -> occurrences seen since the last GGA (epoch boundary)
  order: string[]; // priority-sorted key order -- see sentencePriority
  rows: Record<string, LiveRow>;
}

export const initialLiveRowsState: LiveRowsState = { epochCounts: {}, order: [], rows: {} };

// Fixed display priority by sentence TYPE (last 3 letters of the address,
// talker-ID-agnostic -- same "matched by the sentence's last 3 letters
// only" convention nmea.ts's own core parser already uses, so "GNRMC" and
// "GPRMC" rank identically). Direct request: "Preferable RMC/GGA first,
// then others in some fixed order, then GSA/GSV" -- RMC/GGA tie for first
// (both are the core once-per-epoch position sentences), then the other
// named sentence types in a fixed reading order (matching the reference
// tool transcribed in docs/GPS-MONITOR-PLAN.md §2), then GSA/GSV last
// (the high-volume, multi-sentence-per-epoch ones). An address whose type
// isn't in this table (including the '?' fallback for a line with no '$'
// anywhere at all) lands in DEFAULT_SENTENCE_PRIORITY, grouped with the
// "other" named types rather than at either extreme.
const SENTENCE_PRIORITY: Record<string, number> = {
  RMC: 0,
  GGA: 0,
  VTG: 1,
  GLL: 2,
  ZDA: 3,
  HDG: 4,
  GNS: 5,
  GSA: 10,
  GSV: 11,
};
const DEFAULT_SENTENCE_PRIORITY = 6;

function sentencePriority(address: string): number {
  return SENTENCE_PRIORITY[address.slice(-3)] ?? DEFAULT_SENTENCE_PRIORITY;
}

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
  // Bug report, confirmed via the pause button this feature exists for:
  // a receiver emitting a binary protocol (e.g. UBX) alongside NMEA can
  // send a frame with no line terminator of its own -- connection.ts's
  // newline-based line-splitting doesn't cut it into its own "line" at
  // all, so it just rides along glued onto whatever real
  // "$...*XX\r\n" sentence happens to follow next in the stream (always
  // the SAME sentence content in the observed case -- an RMC void-fix
  // sentence, which is naturally identical every epoch with no fix yet).
  // Since the garbage prefix differs byte to byte, keying off whichever
  // text happens to come before the address (previously: only stripped a
  // LEADING '$', otherwise used the whole raw text) gave every such
  // hybrid line a different, ever-changing address -- flooding this view
  // with one-off rows that never repeat instead of the stable small set
  // it's meant to show. Taking the LAST '$' in the line (not just
  // checking whether it STARTS with one) finds the real sentence
  // reliably regardless of what binary noise precedes it, so all these
  // hybrids collapse back onto the one stable address they actually
  // share. A line with no '$' anywhere at all (pure binary, no attached
  // sentence) still falls back to the whole trimmed text for addressing.
  const lastDollarIdx = trimmed.lastIndexOf('$');
  const hasDollar = lastDollarIdx >= 0;
  const afterDollar = hasDollar ? trimmed.slice(lastDollarIdx + 1) : trimmed;
  const commaIdx = afterDollar.indexOf(',');
  const rawAddress = commaIdx >= 0 ? afterDollar.slice(0, commaIdx) : afterDollar;
  const address = rawAddress.length > 0 ? rawAddress : '?';

  // Displayed content: just the real sentence (from the last '$' onward),
  // not the whole raw line -- bug report: "Monitor still shows the
  // garbage in front of RMC." Once the address extraction above already
  // knows where the real sentence starts, showing the garbage ahead of it
  // is noise, not useful transparency (the Scrolling raw view, unchanged,
  // is still there for anyone who wants the byte-for-byte unmodified
  // stream). A line with no '$' anywhere still shows its full raw text --
  // there's no "real sentence" to isolate it from.
  const displayLine = hasDollar ? trimmed.slice(lastDollarIdx) : rawLine;

  // GGA marks the epoch boundary -- reset before processing this line so
  // the GGA itself is the new epoch's first occurrence, not the previous
  // epoch's last (same convention as PLAN.md §10 and nmea.ts's own
  // last-3-letters sentence-type check).
  const epochCounts = address.endsWith('GGA') ? {} : state.epochCounts;

  const count = (epochCounts[address] ?? 0) + 1;
  const key = `${address} #${count}`;

  const insertionOrder = state.order.includes(key) ? state.order : [...state.order, key];
  const rows = { ...state.rows, [key]: { key, address, line: displayLine } };

  // Re-sorted every call (cheap -- at most a handful of distinct keys),
  // not just when a new key is inserted, so a row's FIXED priority
  // position is correct even the first time it appears, regardless of
  // what else has already arrived. Array.prototype.sort is a stable sort
  // (guaranteed since ES2019), so rows sharing the same priority (e.g.
  // three GSA lines within one epoch, or GGA/RMC's shared top priority)
  // keep their original first-seen relative order among themselves --
  // only the PRIORITY GROUPS are reordered, not the rows within one.
  const order = insertionOrder
    .slice()
    .sort((a, b) => sentencePriority(rows[a].address) - sentencePriority(rows[b].address));

  return {
    epochCounts: { ...epochCounts, [address]: count },
    order,
    rows,
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
  return CONSTELLATION_LABELS[talkerId] ?? `Unknown talker (${talkerId})`;
}

const SYSTEM_ID_LABELS: Record<string, string> = {
  '1': 'GPS',
  '2': 'GLONASS',
  '3': 'Galileo',
  '4': 'BeiDou',
  '5': 'QZSS',
  '6': 'NavIC',
};

/** NMEA 4.11+ GSA's trailing System ID field (a numeric string, '1'..'6')
 * as the same short human label describeConstellation() produces for a
 * talker ID -- this is what lets a GSA sentence sharing a talker-ID-less
 * "GN" address still be matched to the right GSV constellation, by
 * comparing describeSystemId(gsa.systemId) against
 * describeConstellation(gsv.talkerId) (PLAN.md §4's GSA/GSV
 * cross-reference join, built in a later phase). */
export function describeSystemId(systemId: string): string {
  return SYSTEM_ID_LABELS[systemId] ?? `Unknown systemId (${systemId})`;
}
