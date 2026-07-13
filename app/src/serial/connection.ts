// PLAN.md §5 #4 / §6: Web Serial glue -- requestPort() on a click, open at
// the chosen baud, read via TextDecoderStream, line-split, feed lines
// through nmea.ts/nmeaFix.ts, and push good fixes into the observer
// store (§5) plus a GPS/system clock offset for effectiveTime to
// discipline itself with (§6, see clock.ts). Unlike nmea.ts/nmeaFix.ts
// this talks to a real browser API and isn't unit-tested; keep it as
// thin as possible so the untested surface stays small.
import { writable } from 'svelte/store';
import { parseNmeaSentence } from './nmea';
import { applyNmeaSentence, initialNmeaFixState, type NmeaFixState } from './nmeaFix';
import { appendLine } from './monitor';
import { setObserver } from '../stores/observer';

export type GpsConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface GpsConnectionState {
  status: GpsConnectionStatus;
  error: string;
  fix: NmeaFixState;
  // True once the user has locked the observer position via freezeGps()
  // (direct request -- manual only, no auto-freeze heuristic). `fix`
  // above keeps updating live either way, so the status line and any
  // future accuracy display stay honest -- only the observer marker
  // stops moving, since even a "good" fix's reported position can still
  // jitter a few meters report to report, which is the whole reason to
  // freeze once a trustworthy one is in hand.
  frozen: boolean;
  // GPS UTC minus system clock at the last time-bearing sentence -- null
  // whenever not connected or no time sample has arrived yet. This is a
  // throttled COPY of the module-level clockOffsetMs below, kept in the
  // store purely for display (TopBar's GPS Δ badge); the live
  // discipline itself (clock.ts's effectiveTime) reads the unthrottled
  // module variable directly via getGpsClockOffsetMs, not this field.
  clockOffsetMs: number | null;
  // Ring buffer of the most recent raw lines read from the port (oldest
  // first), for the gear popover's NMEA stream monitor -- every line
  // goes in here regardless of whether it parsed (see monitor.ts's
  // appendLine), unthrottled: unlike fix/clockOffsetMs above this never
  // touches the observer store, so there's no expensive cascade to
  // rate-limit, only cheap text rendering. Reset on a fresh connect, but
  // deliberately left alone on disconnect -- same "freeze the last
  // known state" philosophy as `fix` above -- so the last few lines
  // before a drop stay visible for a post-mortem.
  recentLines: string[];
  // True once a port has ever been successfully opened this session
  // (see lastPort below) -- lets the main GPS button reconnect without
  // re-showing Chrome's native picker. Deliberately never reset back to
  // false (not even on disconnect), since lastPort itself isn't either.
  hasRememberedPort: boolean;
}

export const gpsConnection = writable<GpsConnectionState>({
  status: 'idle',
  error: '',
  fix: initialNmeaFixState,
  frozen: false,
  clockOffsetMs: null,
  recentLines: [],
  hasRememberedPort: false,
});

// How many raw lines the gear popover's NMEA monitor keeps around --
// generous enough to show a few seconds of a chatty 10Hz multi-
// constellation receiver's GGA+RMC+GSA+GSV+VTG+GLL burst, small enough
// to stay a glance-able debug panel rather than a full log.
const RAW_LINE_HISTORY = 40;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// Module-singleton connection state -- exactly one GPS device at a time,
// same convention as the module-singleton `observer`/`clock` stores
// (there's only ever one TopBar GPS button, so no need for this to be
// instance-scoped).
let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;
let keepReading = false;

// The most recently *successfully opened* port, kept even after
// disconnectGps() closes `port` above -- lets the main GPS button
// (toggleGps in GpsPanel.svelte) reconnect to the same device without
// re-showing Chrome's native picker every time (direct request -- "now
// browser wants to choose the port" every time was the complaint).
// Never reset to null: Web Serial's own permission grant already
// outlives this anyway (it's per-origin, persists across reloads), so
// there's nothing to be gained by forgetting it sooner. If the physical
// device really is gone, reconnecting to it just surfaces open()'s own
// error -- no special invalidation needed.
let lastPort: SerialPort | null = null;

// Bumped at the start of every connect attempt (openPort) and by
// disconnectGps()/the native 'disconnect' listener -- lets an in-flight
// attempt notice, once its own await resolves, that it's been superseded
// by a NEWER attempt or an explicit disconnect, and bail out instead of
// clobbering whatever superseded it. Closes a real race (bug report):
// picking a different already-granted port while one was already
// connected used to leave the first port open (leaked OS lock) and its
// still-running read loop fighting the new one over the shared `reader`
// variable below; separately, switching to a different position source
// while a connect was still in flight could get silently undone once
// that connect's open() finally resolved.
let connectionGeneration = 0;

/** Stops the read loop and releases whatever port is currently open (if
 * any) -- shared by disconnectGps() and by openPort() below, which now
 * always tears down any existing connection before starting a new one
 * rather than requiring every caller to remember to disconnect first.
 * Safe to call with nothing open (all three operations are no-ops via
 * the `?.`/empty-catch). Does NOT touch the gpsConnection store or
 * connectionGeneration -- callers own those, since "tear down the wire"
 * and "what the UI should show next" are different decisions (openPort
 * wants 'connecting' throughout; disconnectGps wants 'idle' at the end). */
async function teardownConnection(): Promise<void> {
  keepReading = false;
  try {
    await reader?.cancel();
  } catch {
    // stream already errored/closed -- nothing left to cancel
  }
  try {
    await port?.close();
  } catch {
    // already closed
  }
  port = null;
  clockOffsetMs = null;
}

// Local, non-reactive accumulator -- updated on EVERY parsed line (a
// 10Hz receiver means up to 10/sec), but only flushed into the Svelte
// store -- which drives the observer marker and cascades into the full
// local-circumstances/sky-view recompute -- at the throttled cadence
// below. This is a stationary eclipse-observing setup, not a moving
// vehicle, so there's no benefit to redoing that recompute 10x/sec just
// because the receiver can talk that fast.
//
// The throttle is now UNIFORM -- no bypass for hasFix transitions
// (dropped after a real "buffer overrun" report). setObserver()
// synchronously cascades into Svelte's derived local-circumstances
// (iterative Besselian root-finding + astronomy-engine's SearchRiseSet)
// and sky-view (per-star/planet position) recomputes, tens to hundreds
// of ms of real work -- and that used to run immediately, with no rate
// limit, on every single fix-quality flap. Indoors during acquisition a
// marginal signal flaps between fix/no-fix rapidly, so that "always
// flush transitions immediately" rule could fire the expensive cascade
// many times back-to-back, blocking the read loop long enough that the
// browser's own serial receive buffer overran regardless of
// SERIAL_BUFFER_SIZE below (backpressure propagates all the way back to
// the hardware buffer once JS stops draining reader.read() promptly).
// Losing/gaining lock can now lag up to FLUSH_INTERVAL_MS in the status
// line -- an acceptable trade for the connection actually staying up.
let latestFix: NmeaFixState = initialNmeaFixState;
let lastFlushMs = 0;
const FLUSH_INTERVAL_MS = 500;

// Generous defense-in-depth margin on top of the throttle above (at
// 115200 baud, still under 1.5s of continuous data) -- Chrome's own
// default is a stingy 255 bytes, nowhere near enough for a 10Hz
// multi-constellation receiver's GGA+RMC+GSA+several GSV blocks+VTG+GLL
// per epoch even without any read-loop stall at all.
const SERIAL_BUFFER_SIZE = 16384;

// Plain module variable, not a store field -- read directly by
// clock.ts's effectiveTime on its own pre-existing 1Hz tick (see
// getGpsClockOffsetMs), rather than as a new reactive dependency. That
// keeps disciplining the clock from a fast GPS feed free: it rides the
// tick that already happens every second regardless, instead of adding
// up to 10 extra recomputations of its own.
let clockOffsetMs: number | null = null;

/** The live clock's GPS/system offset, in ms (GPS UTC - system clock),
 * or null when not connected / no time sample yet. clock.ts's
 * effectiveTime adds this to the system tick in 'live' mode -- see its
 * own comment for why this is a plain function call, not a store. */
export function getGpsClockOffsetMs(): number | null {
  return clockOffsetMs;
}

/** Ports the page has previously been granted access to -- Web Serial
 * never lists ungranted devices (a privacy boundary in the spec), so
 * this is only ever a subset of what's physically plugged in. Backs the
 * gear popover's port list (GpsPanel.svelte); refreshed on demand
 * (there's no live change event worth wiring up for a debug/config
 * panel). */
export async function listKnownPorts(): Promise<SerialPort[]> {
  if (!isWebSerialSupported()) return [];
  return navigator.serial!.getPorts();
}

/** Whether the given port is the one currently open -- lets the gear
 * popover's port list mark/disable the entry that's already connected
 * instead of offering to "connect" to it again. */
export function isActivePort(p: SerialPort): boolean {
  return port === p;
}

function preflight(): string | null {
  if (!window.isSecureContext) return 'Needs HTTPS or localhost';
  if (!isWebSerialSupported()) return 'Needs a Chromium browser (Chrome/Edge)';
  return null;
}

async function openPort(selected: SerialPort, baudRate: number): Promise<void> {
  // Claims this attempt's generation FIRST (synchronously, before any
  // await) so any older attempt still in flight -- or an explicit
  // disconnectGps() that races with this one -- can tell it's been
  // superseded. Then tears down whatever connection currently exists
  // (a different port left open, or a stuck one from a prior error --
  // see readLoop's catch and disconnectGps, both of which used to be
  // the only places that closed a port) BEFORE opening the new one, so
  // switching ports/retrying after an error never leaks the old handle
  // or leaves two read loops fighting over the shared `reader` variable
  // below.
  const myGeneration = ++connectionGeneration;
  await teardownConnection();
  if (myGeneration !== connectionGeneration) return; // superseded while tearing down

  try {
    // See SERIAL_BUFFER_SIZE's own comment for why this isn't Chrome's
    // 255-byte default.
    await selected.open({ baudRate, bufferSize: SERIAL_BUFFER_SIZE });
  } catch (err) {
    if (myGeneration !== connectionGeneration) return; // superseded meanwhile -- don't clobber whatever replaced us
    gpsConnection.update((s) => ({ ...s, status: 'error', error: describeOpenError(err) }));
    return;
  }

  if (myGeneration !== connectionGeneration) {
    // Something else (a disconnect, or a newer connect attempt) won the
    // race while open() was pending -- e.g. the user switched to a
    // different position source mid-connect. Release the port we just
    // opened instead of adopting it; don't touch any shared state, it's
    // not ours to touch anymore.
    try {
      await selected.close();
    } catch {
      // already closed/never fully opened -- nothing left to release
    }
    return;
  }

  port = selected;
  lastPort = selected;
  latestFix = initialNmeaFixState;
  lastFlushMs = 0;
  clockOffsetMs = null;
  gpsConnection.update((s) => ({
    ...s,
    status: 'connected',
    error: '',
    fix: initialNmeaFixState,
    frozen: false,
    clockOffsetMs: null,
    recentLines: [],
    hasRememberedPort: true,
  }));
  void readLoop(selected);
}

/** First-ever connect (or "Choose a port..." in the gear popover) --
 * always shows Chrome's native device picker, since a page can't
 * enumerate a device it hasn't been granted access to yet. See
 * reconnectLastPort for the no-picker path used once a port has been
 * granted at least once this session. */
export async function connectGps(baudRate: number): Promise<void> {
  const preflightError = preflight();
  if (preflightError) {
    gpsConnection.update((s) => ({ ...s, status: 'error', error: preflightError }));
    return;
  }

  gpsConnection.update((s) => ({ ...s, status: 'connecting', error: '' }));
  let selected: SerialPort;
  try {
    selected = await navigator.serial!.requestPort();
  } catch (err) {
    // Closing the browser's own port picker without choosing anything
    // throws NotFoundError -- that's the user changing their mind, not a
    // real failure, so it goes back to idle quietly rather than showing
    // a scary red error for a no-op.
    const cancelled = err instanceof DOMException && err.name === 'NotFoundError';
    gpsConnection.update((s) => ({
      ...s,
      status: cancelled ? 'idle' : 'error',
      error: cancelled ? '' : describeError(err, 'Could not open the port picker'),
    }));
    return;
  }

  await openPort(selected, baudRate);
}

/** Connects to an already-granted port directly -- no native picker.
 * Used by the gear popover's port list (any previously granted port)
 * and by reconnectLastPort below (specifically the last one that
 * worked). */
export async function connectToPort(selected: SerialPort, baudRate: number): Promise<void> {
  const preflightError = preflight();
  if (preflightError) {
    gpsConnection.update((s) => ({ ...s, status: 'error', error: preflightError }));
    return;
  }
  gpsConnection.update((s) => ({ ...s, status: 'connecting', error: '' }));
  await openPort(selected, baudRate);
}

/** The main GPS pill button's connect action: reuses whatever port
 * worked last time this session (see lastPort), falling back to the
 * native picker (connectGps) the very first time there's nothing to
 * reuse yet. */
export async function reconnectLastPort(baudRate: number): Promise<void> {
  if (!lastPort) {
    await connectGps(baudRate);
    return;
  }
  await connectToPort(lastPort, baudRate);
}

async function readLoop(activePort: SerialPort): Promise<void> {
  if (!activePort.readable) {
    gpsConnection.update((s) => ({ ...s, status: 'error', error: 'Port has no readable stream' }));
    return;
  }
  keepReading = true;
  // TextDecoderStream, not manual byte buffering -- NMEA is plain ASCII
  // and this sidesteps ever splitting a line across a multi-byte
  // boundary. reader lives on this transformed stream, not
  // activePort.readable directly, so disconnectGps() cancelling it
  // propagates the cancellation upstream through the transform and
  // releases the port's own lock too (the standard pattern for closing
  // a Web Serial port cleanly).
  //
  // The cast: TS's lib.dom types TextDecoderStream.writable as
  // WritableStream<BufferSource>, which doesn't structurally satisfy
  // ReadableStream<Uint8Array>.pipeThrough's expected pair type even
  // though Uint8Array IS a BufferSource and this is the exact pattern
  // MDN's own Web Serial + TextDecoderStream examples use -- a known
  // lib.dom typing gap, not a real runtime mismatch.
  reader = activePort.readable
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();
  let buffer = '';
  try {
    while (keepReading) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        applyLine(line);
      }
    }
  } catch (err) {
    if (keepReading) {
      // keepReading is still true -> this wasn't disconnectGps()'s own
      // cancel() causing the rejection, so it's a real device error
      // (e.g. unplugged mid-read, a transient USB/driver hiccup). Closes
      // and releases the port immediately rather than leaving it open
      // with nothing left to drain it (bug report: a transient error
      // used to leave `port` pointing at a still-"open" port forever,
      // so the next reconnect attempt's open() on that same object threw
      // "already open" and the button was stuck erroring until a full
      // page reload) -- and bumps connectionGeneration so a connect
      // attempt already in flight for some OTHER port doesn't get
      // treated as superseded by this cleanup.
      connectionGeneration++;
      keepReading = false;
      try {
        await activePort.close();
      } catch {
        // already closed/gone -- nothing left to release
      }
      if (port === activePort) port = null;
      clockOffsetMs = null;
      gpsConnection.update((s) => ({ ...s, status: 'error', error: describeError(err, 'Serial read error') }));
    }
  } finally {
    reader?.releaseLock();
    reader = null;
  }
}

function applyLine(rawLine: string): void {
  // Recorded unconditionally, BEFORE the parse attempt below -- a wrong
  // baud-rate guess shows up here as garbled bytes, which is itself the
  // most useful thing the monitor can tell the user, not something to
  // filter out.
  gpsConnection.update((s) => ({ ...s, recentLines: appendLine(s.recentLines, rawLine, RAW_LINE_HISTORY) }));

  const sentence = parseNmeaSentence(rawLine);
  if (!sentence) return;
  latestFix = applyNmeaSentence(latestFix, sentence);

  // Unthrottled and independent of the store flush below -- cheap
  // arithmetic, not a store write, so there's no cost to doing this on
  // every one of a 10Hz receiver's sentences. Gated on the sentence
  // actually having a time field (empty until the receiver has SOME
  // time reference, which chipsets typically get before a full position
  // fix) and on a date having been established at least once (RMC-only
  // -- see nmeaFix.ts's withTime) so this never disciplines the clock
  // off a dateless, garbage instant.
  if (sentence.timeOfDay && latestFix.utc) {
    clockOffsetMs = latestFix.utc.getTime() - Date.now();
  }

  const now = Date.now();
  if (now - lastFlushMs >= FLUSH_INTERVAL_MS) {
    lastFlushMs = now;
    flushFix();
  }
}

function flushFix(): void {
  const fixSnapshot = latestFix;
  const offsetSnapshot = clockOffsetMs;
  let shouldApply = false;
  gpsConnection.update((s) => {
    shouldApply = !s.frozen;
    return { ...s, fix: fixSnapshot, clockOffsetMs: offsetSnapshot };
  });
  if (shouldApply && fixSnapshot.hasFix && fixSnapshot.lat !== null && fixSnapshot.lon !== null) {
    const lat = fixSnapshot.lat;
    const lon = fixSnapshot.lon;
    const altitudeM = fixSnapshot.altitudeM ?? undefined;
    // Deferred to a macrotask rather than called inline -- setObserver's
    // synchronous recompute cascade (see the big comment above
    // latestFix) would otherwise run nested inside the tight read loop
    // above, delaying the next reader.read() by however long that
    // cascade takes. Deferring lets the read loop get back to awaiting
    // the next chunk right away instead.
    //
    // keepReading re-checked at fire time, not just at schedule time
    // above (bug report: switching to a different position source
    // didn't reliably stick) -- disconnectGps() sets it false
    // synchronously, but a flush already scheduled a moment earlier was
    // still in flight and would otherwise land after the switch and
    // silently drag observer.source back to 'gps'.
    setTimeout(() => {
      if (!keepReading) return;
      setObserver(lat, lon, 'gps', altitudeM);
    }, 0);
  }
}

/** Locks the observer to whatever fix is current right now -- further
 * live fixes keep updating the status line but stop moving the marker
 * until unfreezeGps(). No-op if there's no fix to freeze onto yet (the
 * TopBar button is disabled in that case). */
export function freezeGps(): void {
  gpsConnection.update((s) => ({ ...s, frozen: true }));
}

/** Resumes live tracking -- immediately applies whatever fix arrived
 * most recently (flushFix, rather than waiting up to FLUSH_INTERVAL_MS
 * for the next line) so unfreezing doesn't have a visible lag. */
export function unfreezeGps(): void {
  gpsConnection.update((s) => ({ ...s, frozen: false }));
  flushFix();
}

export async function disconnectGps(): Promise<void> {
  // Bumped BEFORE tearing down -- an openPort() attempt already in
  // flight (its own open() still pending) checks this after every
  // await, so it notices it's been superseded and releases the port it
  // just opened instead of resurrecting a connection the user explicitly
  // just left.
  connectionGeneration++;
  await teardownConnection();
  gpsConnection.update((s) => ({ ...s, status: 'idle', error: '', frozen: false, clockOffsetMs: null }));
}

function describeError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Same as describeError, but adds an actionable hint for the one
 * open()-failure cause worth calling out specifically: the OS refusing
 * to hand over a port another program already has open (NetworkError
 * per the Web Serial spec -- distinct from InvalidStateError, which
 * means WE already have it open, a case openPort's generation guard
 * above now prevents from happening in the first place). Field-relevant:
 * a laptop running both this app and a separate NMEA-monitoring tool
 * against the same USB GPS receiver is a realistic, not hypothetical,
 * setup. */
function describeOpenError(err: unknown): string {
  const message = describeError(err, 'Could not open port');
  if (err instanceof DOMException && err.name === 'NetworkError') {
    return `${message} (the port may be in use by another program)`;
  }
  return message;
}

// A device physically unplugged mid-connection usually also surfaces as
// a read-loop error above, but this gives it a clearer, immediate
// message rather than waiting on whatever the next failed read()
// happens to throw.
if (isWebSerialSupported()) {
  navigator.serial!.addEventListener('disconnect', (event) => {
    if (event.target !== port) return;
    connectionGeneration++;
    keepReading = false;
    port = null;
    clockOffsetMs = null;
    gpsConnection.update((s) => ({
      ...s,
      status: 'error',
      error: 'GPS device disconnected',
      clockOffsetMs: null,
    }));
  });
}
