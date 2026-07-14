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
  key: string; // display key, e.g. "GNGGA" (singleton) or "GNGSA #2" (repeating)
  address: string; // raw sentence address, e.g. "GNGSA" (talkerId+sentenceId, no '$')
  count: number; // occurrence ordinal within the epoch (always 1 for singleton types) -- sort tiebreak, see compareRows
  line: string; // the latest raw line for this slot
}

/** Accumulated state for the "live rows" raw-stream display mode --
 * PLAN.md §10's addendum. `epochCounts` resets on every GGA arrival (the
 * same once-per-epoch boundary the Hz tracker above already relies on)
 * and is only consulted for REPEATING_TYPES (see below) -- singleton
 * types never read or write it. `rows` persists across calls so a row
 * updates in place rather than being recreated. `order` is a PURE
 * function of `rows` (priority, then address, then count -- see
 * `compareRows`), recomputed from scratch every call rather than carried
 * forward from the previous `order` -- bug report: GpsMonitorPanel.svelte
 * replays only the last 40 raw lines through this function from a fresh
 * `initialLiveRowsState` every time the buffer changes (see its own
 * comment), so any ordering rule that depended on "first key seen in
 * THIS replay" silently reshuffled every time the 40-line window slid by
 * one line, even though nothing about the receiver's actual behavior
 * changed ("RMC and GGA still sometimes switch places... GSV rows jitter
 * violently"). Deriving `order` purely from each row's own (address,
 * count) means the result is identical no matter which subset of lines
 * produced this exact set of rows. */
export interface LiveRowsState {
  epochCounts: Record<string, number>; // address -> occurrences seen since the last GGA (epoch boundary) -- REPEATING_TYPES only
  order: string[]; // priority-sorted key order -- see compareRows
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

// Sentence types that legitimately arrive more than once per epoch (up to
// 3 GSA -- one per constellation -- and multiple GSV messages per
// constellation once satellite counts exceed one message's worth) --
// these are the only types that get an ordinal "#N" row of their own.
// Every other type (RMC, VTG, GLL, ZDA, HDG, GNS, and any unrecognized
// type) is a once-per-epoch "singleton": it always resolves to the SAME
// key (the bare address, no ordinal), so it can only ever occupy exactly
// one row. Bug report: "RMC always in the same place" -- previously RMC
// used the same #N-counting scheme as GSA/GSV, so a dropped/corrupted GGA
// (this receiver's flaky serial link has already shown both buffer
// overruns and glued-on binary garbage) could let two RMC lines arrive
// before the epoch counter reset, spawning a SECOND persistent "GNRMC #2"
// row alongside the original -- exactly the kind of extra, unstable row
// this singleton rule makes structurally impossible.
const REPEATING_TYPES = new Set(['GSA', 'GSV']);

function isRepeatingType(address: string): boolean {
  return REPEATING_TYPES.has(address.slice(-3));
}

/** Deterministic row order: priority group first, then the row's own
 * address (alphabetical, NOT first-seen -- see LiveRowsState's own
 * comment on why first-seen breaks under a sliding replay window), then
 * occurrence ordinal ascending (so "GNGSA #1/#2/#3" or a constellation's
 * multi-message GSV stay in arrival order WITHIN their own address, the
 * one place arrival order is still meaningful). */
function compareRows(a: LiveRow, b: LiveRow): number {
  const priorityDiff = sentencePriority(a.address) - sentencePriority(b.address);
  if (priorityDiff !== 0) return priorityDiff;
  if (a.address !== b.address) return a.address < b.address ? -1 : 1;
  return a.count - b.count;
}

// A well-formed NMEA sentence: '$', then any run of characters that are
// none of '$'/'*'/CR/LF, then a '*' and exactly two hex digits (the
// checksum). Matching this (rather than just locating the last '$', see
// below) bounds BOTH ends of the real sentence, not just its start.
const SENTENCE_PATTERN = /\$[^$*\r\n]*\*[0-9A-Fa-f]{2}/g;

/** Finds the real sentence bounded on both sides, for a raw line that may
 * have binary noise glued onto it. Bug report: a receiver emitting a
 * binary protocol (e.g. UBX) alongside NMEA can send a frame with no line
 * terminator of its own, so it rides along glued onto whatever "line"
 * connection.ts's newline-based splitting hands us next -- usually as a
 * PREFIX ahead of the next real sentence (already handled by keying off
 * the last '$', see below), but if the binary frame happens to contain a
 * stray byte that IS a line terminator, the tail end of that same frame
 * can instead land as a SUFFIX stuck onto the end of a valid sentence,
 * trailing its checksum. A prefix-only search (last '$' onward) doesn't
 * catch that, because it only ever bounds where the sentence STARTS, not
 * where it ends -- bug report: "the binary garbage sometimes leaks
 * through, this time on some other messages [not just RMC]," consistent
 * with whichever sentence type happens to be adjacent to the noise, not
 * RMC specifically. Returns the LAST such match (same "more than one in
 * one line -> the last one is the real one" reasoning as the legacy
 * fallback), or null if no fully-checksummed sentence is present at all
 * (pure binary noise, or a malformed/checksum-less line) -- callers fall
 * back to the older last-'$'-onward heuristic in that case. */
function extractSentence(trimmed: string): string | null {
  const matches = trimmed.match(SENTENCE_PATTERN);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

/** Folds one raw line into the "live rows" state: one row per distinct
 * sentence identity (address, plus a per-epoch ordinal for the handful of
 * types that legitimately repeat -- see `isRepeatingType`), updating in
 * place instead of appending -- a legible alternative to the scrolling
 * `appendLine` view above at a high fix rate (PLAN.md §10).
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
  // "$...*XX\r\n" sentence happens to follow next in the stream. Since
  // the garbage differs byte to byte, keying off whichever text happens
  // to be adjacent to the real sentence (previously: only stripped a
  // LEADING '$', otherwise used the whole raw text) gave every such
  // hybrid line a different, ever-changing address -- flooding this view
  // with one-off rows that never repeat instead of the stable small set
  // it's meant to show. extractSentence() bounds the real sentence on
  // BOTH sides (prefix garbage AND trailing garbage, see its own
  // comment); a line with no '$' anywhere falls back to the last-'$'
  // heuristic, and a line with no '$' at all falls back to the whole
  // trimmed text for addressing.
  const extracted = extractSentence(trimmed);
  const lastDollarIdx = trimmed.lastIndexOf('$');
  const hasDollar = lastDollarIdx >= 0;
  // Displayed content: just the real sentence, not the whole raw line --
  // bug report: "Monitor still shows the garbage in front of RMC" (and
  // later, trailing garbage on other sentence types too). The Scrolling
  // raw view, unchanged, is still there for anyone who wants the
  // byte-for-byte unmodified stream.
  const displayLine = extracted ?? (hasDollar ? trimmed.slice(lastDollarIdx) : rawLine);

  const afterDollar = displayLine.startsWith('$') ? displayLine.slice(1) : displayLine;
  const commaIdx = afterDollar.indexOf(',');
  const rawAddress = commaIdx >= 0 ? afterDollar.slice(0, commaIdx) : afterDollar;
  const address = rawAddress.length > 0 ? rawAddress : '?';

  // GGA marks the epoch boundary -- reset before processing this line so
  // the GGA itself is the new epoch's first occurrence, not the previous
  // epoch's last (same convention as PLAN.md §10 and nmea.ts's own
  // last-3-letters sentence-type check).
  const epochCounts = address.endsWith('GGA') ? {} : state.epochCounts;

  // Only GSA/GSV get a per-epoch ordinal -- every other type (including
  // GGA itself) is a singleton, always keyed by its bare address, so it
  // can only ever occupy ONE row. See REPEATING_TYPES's own comment for
  // why this -- not an ordinal counter -- is what actually makes "RMC
  // always in the same place" true regardless of what the serial link
  // throws at it.
  const repeating = isRepeatingType(address);
  const count = repeating ? (epochCounts[address] ?? 0) + 1 : 1;
  const key = repeating ? `${address} #${count}` : address;
  const nextEpochCounts = repeating ? { ...epochCounts, [address]: count } : epochCounts;

  const rows = { ...state.rows, [key]: { key, address, count, line: displayLine } };

  // Recomputed from `rows` alone every call -- see LiveRowsState's own
  // comment on why threading forward the PREVIOUS `order` (first-seen
  // position) broke under GpsMonitorPanel.svelte's sliding 40-line replay
  // window.
  const order = Object.keys(rows).sort((a, b) => compareRows(rows[a], rows[b]));

  return {
    epochCounts: nextEpochCounts,
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
