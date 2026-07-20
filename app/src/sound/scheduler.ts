// Pure crossing-detection reducer for the sound-warnings feature
// (docs/SOUND-PLAN.md §3.2) -- one uniform "did we cross this event's
// time since the last tick" check that degrades automatically into the
// simple single-event case in live mode (deltas are always small and
// monotonically forward there), with no live/sim mode branching needed
// in this reducer itself. No AudioContext/SpeechSynthesis/DOM dependency
// -- driven externally by whatever event list + current instant the
// caller has (stores/soundWarnings.ts, not yet built -- deferred along
// with sound/eligibility.ts until the event/message table itself is
// settled), zero mocking needed to test.
export interface SchedulableEvent {
  /** Unique id for dedup purposes across ticks -- the caller's
   * responsibility to make it unique (e.g. `${key}:${prewarn}` once the
   * real sound-eligibility layer exists, since a single contact like C2
   * expands into a separate prewarn and at-instant entry). */
  id: string;
  time: Date;
}

export interface SchedulerState {
  lastEffectiveMs: number;
  /** ids already fired, or silently skipped by the multi-crossing
   * collapse below -- never re-fires unless cleared by a backward
   * (sim-scrub) step. */
  fired: ReadonlySet<string>;
}

export interface TickResult {
  state: SchedulerState;
  /** Events to actually fire now -- all crossed events sharing the
   * single most-recently-passed TIME (usually exactly one; more than one
   * only for genuine same-instant companions, e.g. docs/SOUND-PLAN.md
   * §2.3's C2/C3 tone+speech pair), per the multi-crossing collapse rule
   * below. Anything crossed at an EARLIER time than that is silently
   * marked fired without appearing here. */
  toFire: SchedulableEvent[];
}

/** Fresh scheduler state as of `nowMs`. An event already in the past
 * relative to `nowMs` is structurally never fired from here on --
 * lastEffectiveMs only ever grows forward, so that event's time can
 * never again be `> lastEffectiveMs` -- with no need to pre-populate
 * `fired` for it. Callers (stores/soundWarnings.ts) re-create this fresh
 * whenever the eligible-events list itself changes (docs/SOUND-PLAN.md
 * §3.5, e.g. the observer changes) -- a new set of event instances,
 * never partially reconciled against a previous location's fired
 * flags. */
export function initialSchedulerState(nowMs: number): SchedulerState {
  return { lastEffectiveMs: nowMs, fired: new Set() };
}

/** One tick of the reducer -- call unconditionally on every 1Hz tick
 * (stores/now.ts) and on every events-list change, forward or backward,
 * live or sim; no branch on clock mode needed here at all. */
export function tick(state: SchedulerState, curMs: number, events: SchedulableEvent[]): TickResult {
  if (curMs > state.lastEffectiveMs) return tickForward(state, curMs, events);
  if (curMs < state.lastEffectiveMs) return tickBackward(state, curMs, events);
  return { state, toFire: [] };
}

function tickForward(state: SchedulerState, curMs: number, events: SchedulableEvent[]): TickResult {
  const crossed = events.filter((e) => {
    const t = e.time.getTime();
    return !state.fired.has(e.id) && t > state.lastEffectiveMs && t <= curMs;
  });
  const fired = new Set(state.fired);
  const toFire: SchedulableEvent[] = [];
  if (crossed.length > 0) {
    // Zero or one crossed is the overwhelmingly common case (one ~1s
    // tick in live mode, at most one contact could plausibly land in
    // that window). More than one DISTINCT time is only reachable via a
    // sim-mode fast-forward or a big scrub landing past several events
    // in one step -- collapse those down to just the single most-
    // recently-passed TIME, marking anything earlier fired silently.
    // Replaying several stale alerts in one burst because the user
    // fast-forwarded through a rehearsal is noise, not information.
    //
    // But collapsing must be by TIME, not by count: docs/SOUND-PLAN.md
    // §2.3's own design has C2/C3 each expand into two companion
    // SchedulableEvents (a tone entry and a concurrent spoken-
    // confirmation entry) sharing the EXACT SAME instant -- an entirely
    // ordinary single live-mode tick can cross both at once, and that is
    // not the "skipped through a rehearsal" case this collapse exists
    // for. So: find the latest crossed TIME, fire every crossed event AT
    // that time (could be one, could be several genuine companions), and
    // only silently swallow events strictly EARLIER than it.
    let latestMs = crossed[0].time.getTime();
    for (const e of crossed) if (e.time.getTime() > latestMs) latestMs = e.time.getTime();
    for (const e of crossed) {
      fired.add(e.id);
      if (e.time.getTime() === latestMs) toFire.push(e);
    }
  }
  return { state: { lastEffectiveMs: curMs, fired }, toFire };
}

function tickBackward(state: SchedulerState, curMs: number, events: SchedulableEvent[]): TickResult {
  // Sim scrub only -- never happens in live mode. Clears the fired flag
  // for every event whose time is now after curMs, so scrubbing back
  // past a contact and forward again fires it again. No sound plays on
  // the backward step itself.
  const eventById = new Map(events.map((e): [string, SchedulableEvent] => [e.id, e]));
  const fired = new Set<string>();
  for (const id of state.fired) {
    const ev = eventById.get(id);
    // Conservative default if an id from a prior tick isn't found in
    // the current events list (shouldn't happen within one continuous
    // events-list session -- see initialSchedulerState's own re-arming
    // note): keep it fired rather than risk an unverifiable re-fire.
    if (ev && ev.time.getTime() > curMs) continue; // clear -- eligible to fire again
    fired.add(id);
  }
  return { state: { lastEffectiveMs: curMs, fired }, toFire: [] };
}
