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
}

export const gpsConnection = writable<GpsConnectionState>({
  status: 'idle',
  error: '',
  fix: initialNmeaFixState,
  frozen: false,
  clockOffsetMs: null,
});

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

// Local, non-reactive accumulator -- updated on EVERY parsed line (a
// 10Hz receiver means up to 10/sec), but only flushed into the Svelte
// store -- which drives the observer marker and cascades into the full
// local-circumstances/sky-view recompute -- at the throttled cadence
// below (plus immediately on any hasFix transition, so losing/gaining
// lock is never delayed). This is a stationary eclipse-observing setup,
// not a moving vehicle, so there's no benefit to redoing that recompute
// 10x/sec just because the receiver can talk that fast.
let latestFix: NmeaFixState = initialNmeaFixState;
let lastFlushedHasFix = false;
let lastFlushMs = 0;
const FLUSH_INTERVAL_MS = 500;

// See the comment where this is used (connectGps's open() call).
const SERIAL_BUFFER_SIZE = 4096;

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

export async function connectGps(baudRate: number): Promise<void> {
  if (!window.isSecureContext) {
    gpsConnection.update((s) => ({ ...s, status: 'error', error: 'Needs HTTPS or localhost' }));
    return;
  }
  if (!isWebSerialSupported()) {
    gpsConnection.update((s) => ({ ...s, status: 'error', error: 'Needs a Chromium browser (Chrome/Edge)' }));
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

  try {
    // Chrome's own default receive buffer is a stingy 255 bytes -- fine
    // for a slow 1Hz talker, but a 10Hz multi-constellation receiver can
    // emit GGA+RMC+GSA+several GSV blocks+VTG+GLL per epoch (easily
    // several hundred bytes) faster than the async read loop below gets
    // scheduled to drain it, overflowing that buffer and surfacing as a
    // "buffer overrun" error on the very next read(). SERIAL_BUFFER_SIZE
    // is generous on purpose (at 115200 baud it's still under half a
    // second of data) rather than tuned to a specific receiver's output.
    await selected.open({ baudRate, bufferSize: SERIAL_BUFFER_SIZE });
  } catch (err) {
    gpsConnection.update((s) => ({ ...s, status: 'error', error: describeError(err, 'Could not open port') }));
    return;
  }

  port = selected;
  latestFix = initialNmeaFixState;
  lastFlushedHasFix = false;
  lastFlushMs = 0;
  clockOffsetMs = null;
  gpsConnection.update((s) => ({
    ...s,
    status: 'connected',
    error: '',
    fix: initialNmeaFixState,
    frozen: false,
    clockOffsetMs: null,
  }));
  void readLoop(selected);
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
      // (e.g. unplugged mid-read).
      gpsConnection.update((s) => ({ ...s, status: 'error', error: describeError(err, 'Serial read error') }));
    }
  } finally {
    reader?.releaseLock();
    reader = null;
  }
}

function applyLine(rawLine: string): void {
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
  const fixTransitioned = latestFix.hasFix !== lastFlushedHasFix;
  if (fixTransitioned || now - lastFlushMs >= FLUSH_INTERVAL_MS) {
    lastFlushMs = now;
    lastFlushedHasFix = latestFix.hasFix;
    flushFix();
  }
}

function flushFix(): void {
  gpsConnection.update((s) => {
    if (!s.frozen && latestFix.hasFix && latestFix.lat !== null && latestFix.lon !== null) {
      setObserver(latestFix.lat, latestFix.lon, 'gps', latestFix.altitudeM ?? undefined);
    }
    return { ...s, fix: latestFix, clockOffsetMs };
  });
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
  gpsConnection.update((s) => ({ ...s, status: 'idle', error: '', frozen: false, clockOffsetMs: null }));
}

function describeError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// A device physically unplugged mid-connection usually also surfaces as
// a read-loop error above, but this gives it a clearer, immediate
// message rather than waiting on whatever the next failed read()
// happens to throw.
if (isWebSerialSupported()) {
  navigator.serial!.addEventListener('disconnect', (event) => {
    if (event.target !== port) return;
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
