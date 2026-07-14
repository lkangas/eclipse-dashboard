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
import { appendLine, recordFixEvent } from './monitor';
import { setObserver } from '../stores/observer';
import { applyRichNmeaLine, resetGpsSatellites } from '../stores/gpsSatellites';
import { gpsMonitorOpen } from '../stores/layout';

// 'disconnecting' exists so the UI (GpsRibbon's Connect/Connected button)
// has something to disable against for the ENTIRE duration of a
// disconnect, not just the connect side (bug report: clicking
// Connect->Disconnect->Connect fast enough gave "the port is already
// open" -- the store stayed 'connected' throughout disconnectGps()'s
// awaits, so a second click during teardown, or a fast reconnect right
// after it flipped back to idle, could race the still-in-flight close()).
// See disconnectGps's own comment for how this is now guarded at the
// store level too, not just left to the button's disabled attribute.
export type GpsConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';

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
  // Epoch (GGA sentence) arrival rate, averaged over a trailing window
  // (see monitor.ts's recordFixEvent) -- null until enough samples exist
  // to say anything. GpsMonitorPanel's Hz readout/pulse (direct request
  // -- "readily indicates visually whether my gps is in 1hz or 10hz
  // mode"). Reset on a fresh connect, same as recentLines above.
  fixRateHz: number | null;
  // Bumped on every GGA arrival regardless of fix quality -- a `{#key}`
  // trigger for the monitor panel's pulse dot animation, not a count of
  // anything meaningful on its own (deliberately not reset on
  // disconnect -- like recentLines, nothing depends on it starting back
  // at 0).
  fixPulse: number;
  // Wall-clock time (Date.now()) of the last GGA arrival -- lets
  // GpsMonitorPanel detect staleness itself (a receiver that stops
  // emitting GGA specifically, while still sending RMC/GSA, would
  // otherwise leave fixRateHz/fixPulse frozen at their last real value
  // forever, since nothing here re-evaluates them on a timer -- see
  // that component's own isStale comment). Reset on a fresh connect,
  // same as fixRateHz.
  lastFixEventMs: number | null;
  // The baud rate this connection was actually opened at, for the
  // monitor panel's header -- null before any successful connect this
  // session. Left alone on disconnect (same "freeze the last known
  // state" philosophy as fix/recentLines above), only ever set fresh by
  // the next successful openPort().
  baudRate: number | null;
  // True when the current 'error' is specifically "this port won't
  // reopen after being closed" (see isPortStillClosingError's own
  // comment) -- a real, Windows-specific Web Serial/Chromium limitation
  // (confirmed: Firefox had the identical symptom and could only fix it
  // by making their close() synchronous at the C++ level, using
  // CancelIoEx instead of CancelIo -- not something reachable from page
  // JS at all). Bug report: this reproduces even with several seconds
  // between disconnect and reconnect, so it is NOT a brief timing race
  // openPort's retry can wait out -- but reloading the page reliably
  // fixes it (confirmed), so the UI (GpsRibbon) uses this flag to offer
  // a one-click reload instead of leaving the user to discover that
  // workaround themselves from a generic error string.
  needsReload: boolean;
}

export const gpsConnection = writable<GpsConnectionState>({
  status: 'idle',
  error: '',
  fix: initialNmeaFixState,
  frozen: false,
  clockOffsetMs: null,
  recentLines: [],
  hasRememberedPort: false,
  fixRateHz: null,
  fixPulse: 0,
  lastFixEventMs: null,
  baudRate: null,
  needsReload: false,
});

// How many raw lines the gear popover's NMEA monitor keeps around --
// generous enough to show a few seconds of a chatty 10Hz multi-
// constellation receiver's GGA+RMC+GSA+GSV+VTG+GLL burst, small enough
// to stay a glance-able debug panel rather than a full log.
const RAW_LINE_HISTORY = 40;

// Trailing window recordFixEvent averages the GGA arrival rate over --
// long enough to settle a stable-looking 1 vs 10 Hz reading within
// about one window of connecting, short enough that a receiver's actual
// rate change (a config command sent mid-session) shows up promptly.
const GGA_RATE_WINDOW_MS = 2500;

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

// The promise returned by the currently-running readLoop() (openPort sets
// this instead of firing readLoop off with a bare `void`) -- lets
// teardownConnection await the loop's actual completion, not just
// reader.cancel()'s. Those are NOT the same moment: cancel() resolves
// once the cancellation signal is accepted, but readLoop's own
// `finally { reader?.releaseLock(); ... }` -- which is what actually frees
// the underlying port's readable stream lock -- runs in a separate
// continuation of readLoop's own `await reader.read()`, whose ordering
// relative to cancel()'s resolution isn't guaranteed by the code as
// written (two independent promise chains). Without this, port.close()
// could run while the reader's lock hadn't actually been released yet --
// on real hardware (Windows + a CP210x-class USB-UART bridge, the kind
// of chipset most USB GPS receivers use) that's consistent with the "the
// port is already open" bug report: close() can silently fail (its own
// try/catch swallows the error) if the stream is still locked, leaving
// the browser's internal state -- and the OS-level handle -- never
// actually released, so the very next open() on that same object throws
// InvalidStateError.
let readLoopPromise: Promise<void> | null = null;

// The most recently *successfully opened* port, kept even after
// disconnectGps() closes `port` above -- lets the main GPS button
// (toggleConnect in GpsRibbon.svelte) reconnect to the same device without
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

// The baud rate the current/most-recent connection attempt opened at --
// needed so a buffer-overrun auto-retry (readLoop's catch, below) can
// reopen the same port without the caller having to thread it through.
// Set at the same point openPort() commits to a successful open.
let currentBaudRate: number | null = null;

// How many consecutive buffer-overrun auto-retries have fired for the
// CURRENT connection attempt -- bounded (see MAX_OVERRUN_RETRIES) so a
// receiver that overruns no matter what doesn't retry forever. Reset to 0
// on a genuinely fresh (non-retry) openPort() call and again once a real
// GGA arrives (see applyLine) -- either signals "this is a new attempt or
// a now-healthy connection," not a continuation of the same struggle.
let overrunRetryCount = 0;

// Cheap synchronous mirror of gpsMonitorOpen (stores/layout.ts), kept in
// sync via subscribe() rather than a get()-per-line call -- gates the
// "rich" GSV-and-beyond parsing (nmeaRich.ts/nmeaSatellites.ts, via
// applyRichNmeaLine below) so it's a complete no-op whenever the monitor
// panel isn't open. See docs/GPS-MONITOR-PLAN.md §3 for the full
// reasoning: a 10Hz multi-constellation receiver's GSV traffic scales
// with satellite count and is otherwise wasted work nobody's looking at.
// The core GGA/RMC/GSA-fixType pipeline below (applyNmeaSentence,
// setObserver) is deliberately NOT gated by this -- that's the
// safety-critical path this app's own position/clock discipline depends
// on regardless of whether the diagnostic monitor is open.
let monitorActive = false;
gpsMonitorOpen.subscribe((v) => {
  monitorActive = v;
});

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
  // Wait for readLoop's own promise to settle, not just reader.cancel()'s
  // -- see readLoopPromise's own comment for why those differ and why
  // this matters. readLoop() already catches everything it can throw
  // internally, so this is just belt-and-suspenders; a null/already-
  // settled readLoopPromise resolves immediately either way.
  try {
    await readLoopPromise;
  } catch {
    // readLoop handles/logs its own errors already -- nothing left to do
  }
  readLoopPromise = null;
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
//
// Bumped 500ms -> 1000ms (bug report: "buffer overrun" on connect against
// a real receiver -- a u-blox M10 -- the first hardware this throttle had
// actually been tested against; the original value was reasoned from a
// mocked SerialPort, not measured, per this file's own git history).
// Doubling the interval halves how often the expensive setObserver
// cascade can possibly fire, directly per HANDOFF-2026-07-13.md's own
// first-listed remediation step for exactly this symptom.
let latestFix: NmeaFixState = initialNmeaFixState;
let lastFlushMs = 0;
const FLUSH_INTERVAL_MS = 1000;

// GGA arrival timestamps feeding the Hz readout/pulse (monitor.ts's
// recordFixEvent) -- unthrottled and independent of the flush above,
// same reasoning as recentLines: only touches gpsConnection, never
// observer, so there's no expensive cascade to rate-limit.
let ggaTimestamps: number[] = [];

// Defense-in-depth margin on top of the throttle above (at 115200 baud,
// still under 6s of continuous data) -- Chrome's own default is a stingy
// 255 bytes, nowhere near enough for a 10Hz multi-constellation
// receiver's GGA+RMC+GSA+several GSV blocks+VTG+GLL per epoch even
// without any read-loop stall at all.
//
// Bumped 16384 -> 65536 (bug report: "buffer overrun" on connect against
// a real u-blox M10 -- see FLUSH_INTERVAL_MS's own comment for the fuller
// story; this is HANDOFF-2026-07-13.md's second-listed remediation step,
// paired with the FLUSH_INTERVAL_MS bump rather than instead of it, since
// neither alone was confirmed sufficient against real hardware before
// now). A receiver that also emits binary UBX frames interleaved with
// NMEA (which a u-blox M10 can, if not configured NMEA-only) inflates the
// real byte volume beyond a pure-NMEA-text estimate, which this margin is
// now sized to tolerate too -- though disabling UBX output on the
// receiver itself (NMEA-only) remains the more fundamental fix for that
// specific case, not something this buffer size alone can fully paper
// over.
const SERIAL_BUFFER_SIZE = 65536;

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
 * port picker (GpsRibbon.svelte); refreshed on demand
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

async function openPort(selected: SerialPort, baudRate: number, isOverrunRetry = false): Promise<void> {
  // A genuinely fresh attempt (not readLoop's own auto-retry calling back
  // in) starts with a clean overrun-retry budget -- see overrunRetryCount's
  // own comment for why the auto-retry path itself must NOT reset this.
  if (!isOverrunRetry) overrunRetryCount = 0;

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

  // A SHORT sanity-check retry, and ONLY for the specific failure that
  // looks like the OS/driver hasn't fully released the port from the
  // close() a few lines up yet (see isPortStillClosingError's own
  // comment) -- deliberately NOT a long/generous retry. Bug report: this
  // failure reproduces even several seconds after disconnecting, not
  // just on a rushed reconnect, so waiting it out isn't actually a real
  // fix -- confirmed via the WICG/serial and Mozilla issue trackers,
  // this is a known Windows-specific Web Serial limitation (Firefox's
  // own fix required making close() synchronous at the C++ level via
  // CancelIoEx -- not reachable from page JS at all). OPEN_RETRY_DELAYS_MS
  // exists to catch the genuinely-brief case cheaply, not to paper over
  // the persistent one; needsReload (below) is the actual fix for that.
  for (let attempt = 0; attempt <= OPEN_RETRY_DELAYS_MS.length; attempt++) {
    try {
      // See SERIAL_BUFFER_SIZE's own comment for why this isn't Chrome's
      // 255-byte default.
      await selected.open({ baudRate, bufferSize: SERIAL_BUFFER_SIZE });
      break;
    } catch (err) {
      if (myGeneration !== connectionGeneration) return; // superseded meanwhile -- don't clobber whatever replaced us
      const stillClosing = isPortStillClosingError(err);
      if (attempt < OPEN_RETRY_DELAYS_MS.length && stillClosing) {
        await new Promise((resolve) => setTimeout(resolve, OPEN_RETRY_DELAYS_MS[attempt]));
        if (myGeneration !== connectionGeneration) return; // superseded during the retry delay
        continue;
      }
      gpsConnection.update((s) => ({
        ...s,
        status: 'error',
        error: describeOpenError(err),
        needsReload: stillClosing,
      }));
      return;
    }
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
  ggaTimestamps = [];
  currentBaudRate = baudRate;
  // Same "fresh connect starts clean" convention as recentLines/fixRateHz
  // below -- NOT called from disconnectGps(), since satellite data should
  // freeze at its last-known state on disconnect for a post-mortem look,
  // same philosophy as recentLines itself (see that field's own comment).
  resetGpsSatellites();
  gpsConnection.update((s) => ({
    ...s,
    status: 'connected',
    error: '',
    fix: initialNmeaFixState,
    frozen: false,
    clockOffsetMs: null,
    recentLines: [],
    hasRememberedPort: true,
    fixRateHz: null,
    lastFixEventMs: null,
    baudRate,
    needsReload: false,
  }));
  // Tracked (not fire-and-forget) so teardownConnection can await this
  // exact loop's actual completion -- see readLoopPromise's own comment.
  readLoopPromise = readLoop(selected);
}

/** First-ever connect (or "Choose a port..." in the gear popover) --
 * always shows Chrome's native device picker, since a page can't
 * enumerate a device it hasn't been granted access to yet. See
 * reconnectLastPort for the no-picker path used once a port has been
 * granted at least once this session. */
export async function connectGps(baudRate: number): Promise<void> {
  const preflightError = preflight();
  if (preflightError) {
    gpsConnection.update((s) => ({ ...s, status: 'error', error: preflightError, needsReload: false }));
    return;
  }

  gpsConnection.update((s) => ({ ...s, status: 'connecting', error: '', needsReload: false }));
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
    gpsConnection.update((s) => ({ ...s, status: 'error', error: preflightError, needsReload: false }));
    return;
  }
  gpsConnection.update((s) => ({ ...s, status: 'connecting', error: '', needsReload: false }));
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
    gpsConnection.update((s) => ({ ...s, status: 'error', error: 'Port has no readable stream', needsReload: false }));
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

      // Bug report: "buffer overrun" on connect against a real receiver
      // (a u-blox M10), reproducing on the first one or two attempts and
      // then succeeding after manually hitting reconnect a few times --
      // consistent with a receiver that was already streaming continuously
      // handing the OS/driver a backlog larger than SERIAL_BUFFER_SIZE
      // before this app's read loop ever gets a chance to drain it, not an
      // ongoing per-line processing bottleneck (this app's own throttled
      // setObserver cascade already accounts for that, see
      // FLUSH_INTERVAL_MS's own comment). Since manually clicking
      // reconnect repeatedly was already an effective (if tedious)
      // workaround, do that automatically instead of making the user do
      // it by hand: retry the SAME port/baud a bounded number of times
      // before giving up and surfacing an error.
      const overrun = isBufferOverrunError(err);
      if (overrun && overrunRetryCount < MAX_OVERRUN_RETRIES && currentBaudRate !== null) {
        overrunRetryCount++;
        const retryBaud = currentBaudRate;
        gpsConnection.update((s) => ({
          ...s,
          status: 'connecting',
          error: `Buffer overrun -- retrying (${overrunRetryCount}/${MAX_OVERRUN_RETRIES})…`,
          needsReload: false,
        }));
        // Deferred via setTimeout, not called directly here -- openPort()
        // internally awaits teardownConnection(), which awaits
        // readLoopPromise; calling it synchronously from inside THIS
        // still-executing readLoop would mean awaiting this exact call's
        // own not-yet-settled promise (a deadlock). Deferring to a new
        // macrotask lets this readLoop() call finish first (finally
        // block included, resolving readLoopPromise), same "escape the
        // current call stack" technique flushFix() already uses for
        // setObserver below.
        setTimeout(() => {
          void openPort(activePort, retryBaud, true);
        }, OVERRUN_RETRY_DELAY_MS);
      } else {
        gpsConnection.update((s) => ({
          ...s,
          status: 'error',
          error: overrun
            ? `${describeError(err, 'Serial read error')} -- auto-retry exhausted after ${MAX_OVERRUN_RETRIES} attempts. Try reconnecting manually, or check whether the receiver is sending more than this app expects (e.g. a binary protocol like UBX interleaved with NMEA -- configuring the receiver for NMEA-only output would help).`
            : describeError(err, 'Serial read error'),
          needsReload: false,
        }));
      }
    }
  } finally {
    reader?.releaseLock();
    reader = null;
  }
}

// How many consecutive buffer-overrun auto-retries readLoop's catch will
// attempt before giving up and surfacing an error -- bounded so a
// receiver that overruns no matter what doesn't retry forever silently.
// Chosen generously above what manual retrying needed in the bug report
// ("a few times"), not tuned precisely -- there's no strong reason to
// believe a specific number of retries is "correct" here, just that a
// handful is cheap to attempt and matches what worked by hand.
const MAX_OVERRUN_RETRIES = 5;

// Short, fixed delay between an overrun and the automatic retry -- mostly
// to avoid hammering the OS with instant back-to-back open() calls in a
// tight loop, not because a specific wait is known to help drain any
// backlog (closing the port during this delay doesn't itself drain
// anything -- see isBufferOverrunError's own comment for what's actually
// suspected to be happening).
const OVERRUN_RETRY_DELAY_MS = 500;

/** Whether a read() failure is (or looks like) the Web Serial spec's
 * BufferOverrunError -- the OS/driver-level receive buffer filled with
 * more data than SERIAL_BUFFER_SIZE before this app's read loop drained
 * it. Checks err.message too, not just err.name, as a defensive fallback
 * in case a given Chrome version surfaces this under a slightly different
 * DOMException name -- the bug report's own error text contained "buffer
 * overrun" directly, which the message check will always catch regardless
 * of the exact name. */
function isBufferOverrunError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  if (err.name === 'BufferOverrunError') return true;
  return /overrun/i.test(err.message);
}

function applyLine(rawLine: string): void {
  // Recorded unconditionally, BEFORE the parse attempt below -- a wrong
  // baud-rate guess shows up here as garbled bytes, which is itself the
  // most useful thing the monitor can tell the user, not something to
  // filter out.
  gpsConnection.update((s) => ({ ...s, recentLines: appendLine(s.recentLines, rawLine, RAW_LINE_HISTORY) }));

  // Gated on the monitor panel actually being open (see monitorActive's
  // own comment) -- everything downstream of this (GSV reassembly into
  // per-constellation satellite lists) is otherwise skipped entirely.
  if (monitorActive) applyRichNmeaLine(rawLine);

  const sentence = parseNmeaSentence(rawLine);
  if (!sentence) return;
  latestFix = applyNmeaSentence(latestFix, sentence);

  // GGA is the standard once-per-epoch position sentence -- its arrival
  // rate IS the receiver's configured fix rate (1Hz/10Hz/...), unlike
  // raw line count above (a receiver emits several sentence types per
  // epoch regardless of fix rate, so counting every line would just
  // measure "how chatty is this sentence mix," not the fix rate itself).
  if (sentence.type === 'GGA') {
    // A real GGA means this connection is genuinely healthy now -- refill
    // the overrun-auto-retry budget (see overrunRetryCount's own comment)
    // so a much-later overrun in an otherwise-long-running session isn't
    // penalized by however many retries the initial connection needed.
    overrunRetryCount = 0;
    const now = Date.now();
    const { timestamps, hz } = recordFixEvent(ggaTimestamps, now, GGA_RATE_WINDOW_MS);
    ggaTimestamps = timestamps;
    gpsConnection.update((s) => ({ ...s, fixRateHz: hz, fixPulse: s.fixPulse + 1, lastFixEventMs: now }));
  }

  // Unthrottled and independent of the store flush below -- cheap
  // arithmetic, not a store write, so there's no cost to doing this on
  // every one of a 10Hz receiver's sentences. Gated on the sentence
  // actually having a time field (empty until the receiver has SOME
  // time reference, which chipsets typically get before a full position
  // fix) and on a date having been established at least once (RMC-only
  // -- see nmeaFix.ts's withTime) so this never disciplines the clock
  // off a dateless, garbage instant.
  if (sentence.type !== 'GSA' && sentence.timeOfDay && latestFix.utc) {
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

/** Tears down the current connection. Safe to call more than once
 * concurrently or redundantly (bug report: a second click on the
 * Connect/Connected button while a disconnect was already tearing down
 * the port -- possible in the gap before the store's status even
 * reaches 'disconnecting', let alone before any UI re-renders a disabled
 * button -- used to fire a second overlapping disconnectGps(), racing
 * the first over the shared `port`/`reader`; and TopBar's leaveGps()
 * calls this any time the user switches away from GPS regardless of
 * whether a disconnect is already in flight). The guard below reads and
 * updates status in the SAME synchronous store-update callback, so
 * there's no gap between "check if already idle/disconnecting" and
 * "claim it" for a second call to land in -- JS's run-to-completion
 * semantics mean that callback always finishes before the next
 * disconnectGps() call (from a second click, or leaveGps()) can start
 * its own. */
export async function disconnectGps(): Promise<void> {
  let alreadyStopping = false;
  gpsConnection.update((s) => {
    if (s.status === 'idle' || s.status === 'disconnecting') {
      alreadyStopping = true;
      return s;
    }
    return { ...s, status: 'disconnecting' };
  });
  if (alreadyStopping) return;

  // Bumped BEFORE tearing down -- an openPort() attempt already in
  // flight (its own open() still pending) checks this after every
  // await, so it notices it's been superseded and releases the port it
  // just opened instead of resurrecting a connection the user explicitly
  // just left.
  connectionGeneration++;
  await teardownConnection();
  gpsConnection.update((s) => ({
    ...s,
    status: 'idle',
    error: '',
    frozen: false,
    clockOffsetMs: null,
    needsReload: false,
  }));
}

function describeError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// How long openPort's short sanity-check retry waits between attempts --
// see isPortStillClosingError's own comment for what it's working
// around, and needsReload's own comment for why this is deliberately
// short (a few quick attempts, not a long wait-it-out loop): the actual
// bug report is that this failure persists even several seconds after
// disconnecting, so a longer automatic retry would just make the user
// stare at "Connecting..." for a fix that empirically doesn't arrive
// that way. This catches the genuinely-brief case cheaply; needsReload
// covers the persistent one.
const OPEN_RETRY_DELAYS_MS = [300, 800];

/** Whether an open() failure looks like the OS/driver hasn't actually
 * finished releasing this same port from a just-completed close() yet --
 * worth openPort's short sanity-check retry for, since a resolved
 * close() promise doesn't guarantee the underlying handle is released
 * instantly, particularly on Windows with a USB-UART bridge chipset
 * (e.g. the CP210x family most USB GPS receivers use). Chrome surfaces
 * this specific case as InvalidStateError -- distinct from NetworkError,
 * which means a DIFFERENT program has the port and a retry here
 * couldn't possibly help (describeOpenError's existing hint for that
 * case).
 *
 * Confirmed via the WICG/serial and Mozilla/Firefox issue trackers: this
 * is a known, Windows-specific Web Serial limitation, not a bug specific
 * to this app's cleanup sequencing. Firefox hit the identical symptom
 * and could only fix it by making their close() implementation
 * synchronous at the C++ level (using CancelIoEx instead of CancelIo to
 * cancel in-flight I/O) -- something no page-level JS can do. That's why
 * this retry is short and needsReload exists as the real recovery path:
 * there is no reliable amount of waiting-and-retrying from application
 * code that fixes this, only a fresh page load (confirmed empirically --
 * a reload always works, reusing the same SerialPort object sometimes
 * doesn't, regardless of how long you wait first). */
function isPortStillClosingError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'InvalidStateError';
}

/** Same as describeError, but adds an actionable hint for the two
 * open()-failure causes worth calling out specifically: the OS refusing
 * to hand over a port another program already has open (NetworkError
 * per the Web Serial spec), or this same port not reopening after a
 * previous close() even after openPort's own short retry
 * (InvalidStateError -- see isPortStillClosingError's own comment, and
 * needsReload for the actual fix this message points at).
 * Field-relevant: a laptop running both this app and a separate
 * NMEA-monitoring tool against the same USB GPS receiver is a realistic,
 * not hypothetical, setup. */
function describeOpenError(err: unknown): string {
  const message = describeError(err, 'Could not open port');
  if (err instanceof DOMException && err.name === 'NetworkError') {
    return `${message} (the port may be in use by another program)`;
  }
  if (isPortStillClosingError(err)) {
    return `${message} -- a known Chrome/Windows limitation reopening this port; reload the page to fix it`;
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
      needsReload: false,
    }));
  });
}
