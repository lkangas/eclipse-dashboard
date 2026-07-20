# Sound Warnings — Plan

Status: **New plan — nothing implemented yet.** `docs/STATUS.md` still lists
this as "zero code... the single largest remaining gap for actual field
use; nobody's reading a screen during totality." This document is the final,
opinionated synthesis of three independently-written design candidates
(pure synthesized tones, speech-first via Web Speech API, and a deliberate
tone+speech hybrid) into one implementation-ready plan — not a summary of
all three, a real judgment call on each decision, with the losing ideas
named and discarded rather than smoothed over. Every claim about this app's
own architecture below (`localCircumstances`, `effectiveTime`/`now`,
`horizonObstruction`, and the actual triplicated "next observable event"
logic) was checked directly against the current source in this session, not
assumed from the candidates' own descriptions of it. T−23 days at time of
writing (2026-08-12, ~18:26–18:33 UT, Spain).

---

## 1. Approach and why

**Recommendation: a hybrid, but a specific, narrow one — Web Audio
oscillator tones own exactly two events (C2, C3), and local-voice-only
`SpeechSynthesis` owns everything else, including a T−30s spoken pre-warning
for C2 and C3 themselves.** No event ever gets a tone-only or speech-only
treatment by default except that narrow C2/C3 pair, which gets *both*,
concurrently, for reasons in §1.3. This is closest to Candidate C's thesis,
deliberately narrowed and corrected in a few places where reading candidates
A and B closely exposed real gaps in C's own execution (§1.4).

### 1.1 Why not tone-only (Candidate A)

Candidate A's actual tone-design work is good — the mid-range-frequency
reasoning (400–1050 Hz, reproducible on cheap laptop/phone speakers), the
audio-clock-scheduled precision, and the sim-mode discontinuity handling are
all correct and reused below. But committing the *entire* warning system to
oscillators means the entire burden of meaning has to be carried by pitch,
rhythm, and repeat-count alone, taught once via a Test Sound button and
relied on forever after — Candidate A's own words: "the entire burden of
distinctiveness falls on a scheme this document has to design deliberately...
rather than relying on the sound being self-explanatory the first time it's
heard in the field." That is an honest description of a real cost, and nine
times out of ten in this specific app it's a cost worth avoiding: most users
of this app will experience C1/C2/Max/C3/C4/Sunset exactly once, in their
life, under field stress, quite possibly with family or friends around —
not the repeated-exposure setting (a smoke alarm, a reversing-vehicle beep)
where a learned tone vocabulary actually earns its keep through repetition.
**A tone can't say "second contact" — only speech can, with zero learned
association required.** That is the one structural advantage speech has
and it is decisive for every event except the two where reaction speed, not
comprehension, is what matters (§1.3). Keep A's tone-engineering rigor;
discard its plan to extend that vocabulary across all six events.

### 1.2 Why not speech-first (Candidate B)

Candidate B contains the single best piece of technical due diligence
across all three candidates and it is adopted wholesale in §1.5/§6.1: the
observation that Chrome and Edge's `speechSynthesis.getVoices()` mixes
genuinely-offline (`localService: true`) voices with cloud-backed
(`localService: false`) ones in the *same list*, with nothing in the naive
`new SpeechSynthesisUtterance(text)` call pattern stopping a browser from
picking a network voice by default. Given this app's own already-verified
"zero runtime network requests, ever" claim (checked directly against the
production build's network log — 3 requests total, page-load only), an
unfiltered speech feature is a real, previously-invisible way to violate
that guarantee the first time the field laptop is actually offline — worse,
it's a *conditional* request that a load-time audit would never catch. This
is a hard blocker unless designed around explicitly, and Candidate B is
right to treat it as one.

Where B goes wrong is making speech the *primary* channel and demoting tone
to "a secondary layer... specifically for the two safety-critical exact-
instant transitions." Read literally, B's own §1.5 and §1.8 already concede
the entire argument this document makes for a hybrid — B's own reasoning
for why C2/C3 need a tone at all ("speech's own latency and queueing
behavior make it a poor fit for 'this is the literal instant' cues") is
identical to this document's §1.3. But B's Phase 1 (§5) then **ships without
that tone layer at all** — "SpeechSynthesis-only playback... for C1/C2/C3/C4
with a fixed 10s pre-warning plus an at-moment line... No... tone layer yet"
— deferring the tone to Phase 2. That is a real inconsistency: it means B's
own proposed MVP covers the two eye-safety-critical instants with *only*
the channel B's own document says is unfit for them. This design corrects
that by putting the tone for C2/C3 in Phase 1 from the start (§6) — it is
not an enhancement layered onto speech, it is the load-bearing part.

### 1.3 Why hybrid, and why this specific division of labor

The real insight (Candidate C's, and the reason this document leans on C's
frame more than A's or B's) is that "precise reaction cue" and "context/
naming" are not two ends of one dial to compromise between — they are two
different *jobs*, and this app's six events split cleanly across them with
no overlap:

- **C2 (totality begins) and C3 (totality ends)** are the only two moments
  where a specific physical action (filter off / filter back on) is tied to
  the *exact* instant, and where getting the instant wrong by more than a
  couple of seconds has a real eye-safety cost. This needs a signal immune
  to platform TTS engine variance, `.speak()`'s tens-to-hundreds-of-ms
  startup latency, and its FIFO (non-overlapping) queueing behavior —
  properties no `SpeechSynthesis` call can fully escape even after voice
  filtering, because they're inherent to the API, not a bug in some
  browser's implementation. Web Audio oscillators sidestep all of it:
  `oscillator.start(audioContext.currentTime + delta)` is honored by the
  browser's own audio-rate clock, immune to main-thread jank, GC pauses, or
  `setInterval`/`setTimeout` throttling.
- **C1, C4, Max (conditionally), and terminal-Sunset (conditionally)** — see
  §2 for exactly when — are informational: "something is about to start,"
  "it's over," "here's how much of the disk is covered." None of them has a
  hard deadline measured in fractions of a second. For these, the ability to
  *name the thing* ("Partial eclipse has begun") beats split-second timing
  by a wide margin, precisely because the user cannot be assumed to have
  memorized what a specific beep pattern means for an event this rare.
- **The T−30s pre-warnings for C2 and C3 themselves** are also informational
  ("something precise is coming soon") rather than the precise cue itself —
  so they're spoken, not toned. This actually *removes* a problem Candidate
  B ran into: B fixed its pre-warning lead at a stingy 10s specifically
  because a spoken pre-warning immediately followed by a spoken at-moment
  line risked the first still being mid-sentence when the second needed to
  fire, forcing an ugly `cancel()`-or-queue choice. That problem is an
  artifact of using speech for *both* halves. Once the at-moment cue is a
  tone (a completely independent playback path that never queues behind
  `SpeechSynthesis`), the pre-warning lead is free to be a comfortable 30s
  with no such constraint — see §3.4 for the one residual edge case (very
  short totality near the corridor edge) and its guard.

**One further refinement beyond all three candidates: C2 and C3 fire the
tone and a spoken confirmation *concurrently*, not tone-only.** The tone is
scheduled with audio-clock precision as the reaction cue; a plain
`speechSynthesis.speak('Totality has begun. Filters off.')` (or the C3
equivalent) is triggered via an ordinary (imprecise, and that's fine)
`setTimeout` landing within roughly the same second, purely as a redundant
naming confirmation for anyone who wasn't certain what the tone meant. This
costs nothing — the tone's precision does not depend on the speech call
succeeding, arriving on time, or even existing on a device with no usable
local voice — and it closes the one real gap in Candidate C's own table
(§2, C's version), which assigns C2/C3's at-instant cell to "tone" only and
never revisits naming for the single most safety-critical moment in the
whole app.

### 1.4 Why this degrades better than either pure candidate

Because the tone half has zero dependency on the speech half succeeding,
this design's failure mode is strictly better than a speech-primary
design's: if the Phase 0 voice-filtering spike (§6, mandatory, done first)
finds no usable local voice on the actual field hardware — or, worse, finds
that mere voice *enumeration* triggers a network call that can't be avoided
(a real, specific risk Candidate B raises and this document treats with the
same seriousness, §5.3) — the result is graceful: informational events fall
back to tone + on-screen text, while C2/C3's tone-based safety cue is
completely unaffected, because it never depended on speech in the first
place. A pure speech-first design has no equivalent fallback for its own
most safety-critical moments without secretly building the same tone this
document builds anyway (which, per §1.2, is exactly what Candidate B's own
document does).

### 1.5 The reliability guardrail this whole design depends on

Non-negotiable, adopted directly from Candidate B: **at "enable sound"
time, enumerate `speechSynthesis.getVoices()` (with the `voiceschanged`
async-population workaround, §6.4), discard every voice where
`localService !== true`, and never construct a `SpeechSynthesisUtterance`
without an explicit `.voice` pointing at a surviving local voice.** If zero
local voices survive the filter, `SpeechSynthesis` is treated as
**unavailable** on that device — never fall through to the browser's
unfiltered default, which is exactly the thing that might silently pick a
network voice. Firefox and Safari, per public documentation, don't appear to
have a "network voice" tier at all; this is specifically a Chrome/Edge
concern — and Chrome/Edge is exactly what `docs/PLAN.md` §12's own manual
e2e checklist already names ("sound arming across browsers (Chrome/Edge)"),
so it can't be waved away as someone else's browser.

### 1.6 Bundle weight and `file://`/IIFE interaction

Zero added bundle weight either way. Web Audio tones are generated
procedurally (`OscillatorNode` + `GainNode` envelope, code not data); local
`SpeechSynthesis` voices are OS-provided, not a bundled asset. Neither needs
`import()` at all, so `vite.config.ts`'s forced `format: 'iife'` (no real
code-splitting benefit — confirmed this session for the `elevation-fine.json`
case, where a dynamic `import()` still blocks on the whole bundle parsing
first) is a non-issue for this feature specifically, unlike the DEM-tier
work in `docs/HORIZON-PLAN.md`. Both APIs are pure runtime computation with
no filesystem/network fetch of their own, so there's no reason to expect
this app's known `file://` module-script restriction to have an analogue
here — worth a direct smoke test under both `file://` and the
`serve-field.cmd` localhost path in Phase 1 regardless (§7), given this
app's own track record of `file://`-specific surprises.

---

## 2. Events and triggers

### 2.1 The six events, and which channel(s) they get

All six keys come directly from `LocalCircumstances`
(`app/src/stores/localCircumstances.ts`): `c1, c2, max, c3, c4, sunset`, all
independently nullable except `max`. No event in this design ever reads a
`Date` field without checking it for `null` first — every row in the table
below is gated by the eligibility rules in §2.2 before it's ever considered
"armed."

| Event | Pre-warning (T−30s) | At-instant | Default |
|---|---|---|---|
| C1 — partial begins | Spoken: *"Partial eclipse begins in about thirty seconds. Solar filter on."* | Spoken: *"Partial eclipse has begun."* | On |
| C2 — totality begins | Spoken: *"Totality in about thirty seconds."* | **Tone** (rising sweep) + spoken: *"Totality has begun. Filters off."* — concurrent, see §1.3 | On |
| Max — greatest eclipse | — (nothing to prepare for) | Spoken: *"Maximum eclipse now."* — **only when Max is the climactic moment for this observer**, see §2.3 | On (conditionally silent) |
| C3 — totality ends | Spoken: *"Totality ending in about thirty seconds."* | **Tone** (falling, faster/more urgent sweep) + spoken: *"Totality has ended. Filters on."* — concurrent | On |
| C4 — partial ends | — (no hard deadline) | Spoken: *"Eclipse has ended."* | On |
| Sunset (terminal only) | Spoken: *"Sun setting in about thirty seconds. Eclipse viewing ending here."* | Spoken: *"Sun has set. Eclipse viewing has ended."* | On (conditionally silent) |

No pre-warning for Max, C4, or non-terminal Sunset — none of them has
anything actionable to prepare for; a countdown to "nothing in particular
happens" is noise, not warning. The tone channel is reserved *exclusively*
for C2/C3 — no other event gets a tone, ever, in any phase (§6's "explicitly
not doing" list) — keeping the "Timing tones" UI toggle (§4) a small,
well-defined control over exactly two sounds rather than a fuzzy grab-bag.

### 2.2 Nullability — the exact gating rule, ported from real existing code

`docs/STATUS.md` already flags this as unsolved: *"Sunset-filtering/'next
observable event' logic is still triplicated across
`ContactsPanel`/`CountdownPanel`/`TimeBar` with no shared tested function."*
Reading the actual triplicated implementations this session (not just
STATUS.md's description of them) turns up the exact rule already in
production, verified against all three files:

- `CountdownPanel.svelte`'s `observable(d)`: `d !== null && (sunsetMs === null
  || d.getTime() <= sunsetMs)`.
- `ContactsPanel.svelte`'s row filter: `r.key === 'sunset' || sunsetMs ===
  null || r.date.getTime() <= sunsetMs`.
- `TimeBar.svelte`'s domain-clamp: caps the track's right edge at
  `Math.min(eventSec.c4, eventSec.sunset ?? Infinity)`, and its label filter
  drops any non-sunset key past `ev.sunset`.

All three independently reimplement the same rule: *a non-null contact is
"observable" iff it's not `sunset` and (`sunset` is null or the contact's
time is at or before `sunset`); `sunset` itself is always structurally
present when non-null.* **Recommendation: extract this now, as part of this
feature (all three input candidates agree, unanimously, and this document
concurs) — but do not retrofit `ContactsPanel`/`CountdownPanel`/`TimeBar`
onto it in the same change.** Those three are shipped, working, and
display-only; a wrong triplicated copy there is a cosmetically-wrong label,
recoverable by a glance elsewhere in the same panel. A wrong copy inside an
*audio trigger* is a warning that fires twice, fires for the wrong contact,
or silently never fires at all — a categorically worse failure for a
feature whose entire premise is "the user isn't looking at the screen to
catch the mistake." That asymmetry is the argument for finally extracting
this now rather than after: get it right once, proven by the one consumer
that has the most to lose from getting it wrong, and treat migrating the
three existing display sites onto the same function as a natural,
non-blocking follow-up once it exists.

New module: **`app/src/eclipse/schedule.ts`** (pure, alongside
`localCircumstances.ts`/`horizon.ts`, no UI or timer coupling):

```ts
export interface ScheduledEvent {
  key: 'c1' | 'c2' | 'max' | 'c3' | 'c4' | 'sunset';
  time: Date;
}

/** Faithful extraction of the rule already live in CountdownPanel/
 * ContactsPanel/TimeBar: null contacts are absent; c1/c2/max/c3/c4 are
 * dropped once past sunset; sunset itself is always included when
 * non-null. Ordered ascending by time. */
export function observableEvents(lc: LocalCircumstances): ScheduledEvent[];
```

### 2.3 Sound-specific layering on top of `observableEvents()` — the two judgment calls the brief asks for, made explicit

`observableEvents()` above is a faithful port of what the three existing
UI consumers *already* do — it is not sound-specific. Sound warnings need
two additional, sound-specific filters layered on top, in a new
**`app/src/sound/eligibility.ts`**:

**Judgment call 1 — sunset only gets a warning when it's actually terminal
for this observer.** `ContactsPanel.svelte`'s table always shows a `sunset`
row when non-null, whether or not it ends up mattering (a table row costs
nothing to ignore). An *audible* warning is not free to ignore the same
way, so the bar is higher: **only warn about sunset when `lc.c4 === null ||
lc.sunset!.getTime() < lc.c4.getTime()`** — i.e., only when the sun actually
sets before the partial phase would otherwise have finished. When sunset
falls comfortably after C4 (the common case away from the sunset-limited
fringe — most of interior Spain), the eclipse is already fully over from
that observer's perspective by the time the ordinary evening sunset comes
around; announcing an unrelated daily event as if it were part of the
eclipse is pure noise, and this design explicitly does not do it. When it
*is* terminal — including the unlucky edge case where sunset falls before
C2 and the observer never sees totality at all — the sunset warning becomes
the single most informative thing this feature tells that observer ("this
is over for you"), not a footnote, and both its pre-warning and at-moment
lines fire per §2.1's table.

*(Note this is a different "sunset is special" rule from the one already
in `horizonObstruction.ts`: that store's `CONTACT_KEYS` computation
deliberately excludes `'sunset'` from its own obstruction flag, for an
unrelated reason — the near-0° threshold trips almost everywhere and isn't
an actionable terrain signal, per `docs/HORIZON-PLAN.md`. The two "sunset is
special" carve-outs are independent of each other; don't conflate them.)*

**Judgment call 2 — terrain obstruction never suppresses a sound warning,
for any event, ever.** Unanimous across all three input candidates, and
correct for two independent reasons: first, `horizonObstruction`'s
`ContactObstruction.obstructed` flag is a DEM-based *prediction*, not a
certainty — `docs/HORIZON-PLAN.md` §3.1 already states plainly that no bare-
earth DEM sees trees, buildings, or the exact hillock the observer ends up
standing behind, so silently withholding the most safety-critical warning
(C3) on a possibly-wrong prediction is a bad trade even before considering
the second reason. Second, and more fundamental: the entire premise of an
audible warning is that the user *isn't* looking at the sky to personally
judge visibility right now — so visibility-to-the-eye and relevance-to-the-
ear are orthogonal properties, and a user might still care about exact
timing (photography, narrating to a group, other instruments) regardless of
whether the Sun itself happens to be behind a ridge at that moment.
**Concretely: `soundEligibleEvents()` never reads `horizonObstruction` at
all** — it has no input from that store, by construction, so there is no
code path by which it could accidentally suppress a warning based on a
terrain prediction.

**Judgment call 3 — Max only gets a spoken announcement when it's the
climactic moment for this observer, not a redundant one.** This
refinement (Candidate C's, and the sharpest of the three candidates' Max
treatments) does more work than either "Max off by default" (A) or "Max
opt-in, off by default" (B): **suppress Max's announcement whenever both
`c2` and `c3` survive `observableEvents()`'s filter** (i.e., a normal,
fully-observable totality is happening here) — because C2's and C3's own
cues already carry "this is the big moment," and a mid-totality "maximum
eclipse now" would be competing noise for someone who should be looking up,
not listening to a redundant status update. **Fire it otherwise** — a
partial-only site (outside the umbral corridor, or at its very edge, where
`c2`/`c3` are null), or a site where sunset cuts off before Max is reached
even though C2 was observable. In those cases Max genuinely is the peak
moment of the whole event for that observer, and nothing else announces it.
Because this condition already removes the redundant case entirely, Max
defaults **on** rather than opt-in — there's no leftover "annoying
duplicate chatter" risk left to guard against with an extra toggle.

```ts
export interface SoundEvent extends ScheduledEvent {
  channel: 'tone' | 'speech';
  prewarn: boolean; // false = at-instant
}

/** Layers the sunset-terminal-only and max-suppression rules on top of
 * observableEvents(); assigns each surviving event its channel(s) per
 * §2.1's table. Never reads horizonObstruction (Judgment call 2). */
export function soundEligibleEvents(lc: LocalCircumstances): SoundEvent[];
```

(C2 and C3 each expand to two `SoundEvent` entries in the real
implementation — one `channel: 'tone'`, one `channel: 'speech'` for the
concurrent confirmation line — rather than a single event trying to carry
two channels; kept as one conceptual row in §2.1's table for readability.)

---

## 3. Timing/scheduling mechanism

### 3.1 Is the existing 1Hz tick good enough? Yes for detection, augmented for firing.

`app/src/stores/now.ts`'s single shared `setInterval(..., 1000)` and
`app/src/stores/clock.ts`'s `effectiveTime` derived store are the correct,
and only, foundation — **no new app-wide timer is added.** Two different
questions get two different answers, and conflating them is the mistake to
avoid:

- *Is 1Hz precise enough to decide "should we be alerting soon"?* Yes,
  trivially. Baily's beads/the diamond ring at C2/C3 unfold over a couple of
  real seconds, not milliseconds; every other time-sensitive view in this
  app (countdown, contacts table, map shadow marker) already treats 1-second
  granularity as sufficient; and nothing here is trying to beat the
  Besselian-element prediction's own inherent uncertainty.
- *Should the C2/C3 tone actually be fired from inside the 1Hz tick
  handler?* No — not because 1Hz is too coarse in principle, but because
  handing the last few seconds to `AudioContext`'s own clock is strictly
  better and free. `oscillator.start(audioContext.currentTime + delta)` is
  sample-accurate and immune to the same main-thread jank/GC pauses/timer
  throttling that could delay a naive `setTimeout` by tens to hundreds of
  milliseconds — exactly the slop that matters at the one place this
  feature cannot afford it.

A dedicated faster-than-1Hz timer was considered and rejected: it would
have to independently re-solve live-vs-sim mode, the GPS-clock-disciplined
offset, and sim scrubbing/pausing/rate-changes — everything
`effectiveTime` already solves — for a second time source that buys nothing
the audio clock doesn't already provide for free in the one place precision
actually matters.

### 3.2 The scheduler: one algorithm, not two separate live/sim code paths

Candidate A argued live and sim mode need "genuinely different strategies,
not one shared code path," reasoning that pre-arming ahead of a threshold is
unsafe in sim mode because a scrub could invalidate it moments later. That's
true of the *specific* pre-arming mechanism, but it doesn't require two
whole scheduler implementations — Candidate C's framing is the better one,
and simpler: **one uniform "did we cross this event's time since the last
tick" check, that happens to degrade automatically into the simple
single-event case in live mode**, because live-mode deltas are always
small (~1s) and monotonically forward. No `if ($clock.mode === 'live')`
branch is needed in the core reducer at all.

**State kept per armed schedule** (recomputed fresh whenever
`soundEligibleEvents(lc)`'s output changes, i.e. whenever `observer` or
`localCircumstances` changes — an entirely new set of event instances, per
`localCircumstances`'s own reactive nature):

```ts
interface SchedulerState {
  lastEffectiveMs: number;
  fired: Set<string>; // keyed by `${key}:${prewarn}`
}
```

**On every tick** (both the 1Hz `now`-driven tick and any immediate
recompute triggered by an `observer`/`localCircumstances` change — cheap
enough to run unconditionally, same precedent as `horizonObstruction`'s own
"cheap enough to run on every observer change without debouncing"):

1. `curMs = effectiveTime.getTime()`.
2. If `curMs > lastEffectiveMs` (forward motion — the only direction that
   ever fires sound): find every not-yet-`fired` event whose time falls in
   `(lastEffectiveMs, curMs]`.
   - **Zero or one such event**: this is the overwhelmingly common case in
     live mode (one tick, ~1s of real time, at most one contact could
     plausibly land in that window) and in slow/paused sim playback. Fire
     it (or do nothing).
   - **More than one** (only reachable via a sim-mode fast-forward or a big
     scrub landing past several events in one step): **collapse to firing
     only the single most-recently-passed event**, per Candidate C's rule —
     mark the rest `fired` silently, no sound. Replaying three or four stale
     alerts in one burst because the user fast-forwarded through a rehearsal
     is noise, not information; the honest answer to "where am I now" is one
     announcement, not a queued replay of everything skipped.
3. If `curMs < lastEffectiveMs` (backward — sim scrub only; never happens in
   live mode): clear the `fired` flag for every event whose time is
   `> curMs`, so scrubbing back past a contact and forward again fires it
   again. No sound plays on the backward step itself.
4. `lastEffectiveMs = curMs`.

This single reducer is a **pure function** — `(SchedulerState, curMs,
SoundEvent[]) → (SchedulerState, SoundEvent[] to fire now)` — with no
`AudioContext`/`SpeechSynthesis`/DOM dependency, matching this codebase's
established pure-reducer-plus-thin-glue convention
(`nmeaFix.ts`/`nmeaSatellites.ts` vs. `connection.ts`; `horizon.ts` vs.
`horizonObstruction.ts`). It lives in **`app/src/sound/scheduler.ts`** and
gets its own `*.test.ts` (§7) with zero mocking required.

This same mechanism also transparently absorbs the smaller live-mode case
`clock.ts`'s own comment already flags — a GPS-clock-offset correction
landing mid-session (`getGpsClockOffsetMs()` changing as a receiver
acquires/loses a fix) is just another `curMs` discontinuity, handled by the
identical forward/backward branches above with no special-casing.

### 3.3 What the tone channel does differently once "fire now" is decided

Speech firing is simple: when the reducer says "fire `c1`'s prewarn now,"
call `speechSynthesis.speak(...)` directly from the tick handler — its own
onset latency (tens to a few hundred ms) is irrelevant against a loose
"about thirty seconds" cue.

The C2/C3 *tone* needs the audio-clock precision from §3.1, which means it
can't simply fire "now" from inside a tick that only runs once a second.
**Arming**: once the reducer's lookahead (computed each tick regardless of
whether anything is due *this* tick) shows a `tone`-channel event is within
`ARM_LEAD_S = 3` seconds **and the current motion is forward with a
plausibly-small delta** (i.e., we're in the "zero or one events crossed"
regime from §3.2, not a big jump), compute the precise remaining delta
against `effectiveTime` and call `oscillator.start(audioContext.currentTime
+ delta)` — the audio clock, not the next tick, now owns the exact playback
moment. Three seconds of lead comfortably covers the tick's own worst-case
~1s detection jitter with margin to spare before computing and issuing the
precise schedule call. **In the same arm step**, schedule the concurrent
spoken confirmation (§1.3) via an ordinary `setTimeout(..., delta * 1000)`
— imprecise is fine here, its whole value is naming, not timing.

**If a sim jump lands *inside* that 3-second arm window or skips past the
event entirely before arming could happen**, the tone falls back to the
same-tick "fire now" path used everywhere else (`oscillator.start(ctx
.currentTime)`, no forward scheduling) — still correct, just without the
audio-clock margin that only matters for live-mode precision in the first
place; sim playback is rehearsal, not the real eye-safety moment.

**Defensive `resume()`**: some browsers (Safari particularly) can
auto-suspend an `AudioContext` after a period of silence even after an
initial `resume()` — call `audioContext.resume()` defensively (cheap,
idempotent) immediately before every scheduled play, not only once at
arm-time, per Candidate A's mitigation.

### 3.4 The short-totality guard

Near the corridor's edges, `localCircumstances.durationS` can shrink toward
zero — `docs/HORIZON-PLAN.md`'s own reasoning about grazing/sunset
incidence applies here too. If C3's own T−30s pre-warning would land within
`SHORT_TOTALITY_GUARD_S = 10` seconds of C2's tone (i.e., `durationS !==
null && durationS < 40`), **skip C3's pre-warning entirely** rather than
stacking a spoken "totality ending soon" almost on top of C2's own tone +
confirmation line — cheap insurance against a confusing back-to-back
collision at exactly the sites where totality is shortest and attention is
most valuable. C3's at-instant tone+speech is never skipped by this guard —
only the loose, genuinely-skippable pre-warning is.

### 3.5 Re-arming on observer/location change

`soundEligibleEvents(lc)` recomputes reactively whenever `observer` (and
therefore `localCircumstances`) changes — dragging the map pin, switching
GPS/Browser/Manual/preset, or a GPS fix updating the position. Every time
its output changes, the scheduler's `SchedulerState` is **fully reset**:
new `lastEffectiveMs`, empty `fired` set, any pending `oscillator.start()`
call still scheduled against the *old* location's contact times is
cancelled. New contact times are, for this purpose, entirely new event
instances — never partially reconciled against the previous location's
already-fired flags. This recompute is cheap enough (a handful of
comparisons over ≤7 `SoundEvent` entries) to run unconditionally, with no
debouncing, matching `horizonObstruction`'s own precedent for reacting to
every observer change.

---

## 4. User controls

### 4.1 One control, in TopBar

A single icon button in `TopBar.svelte`, alongside the existing
mode-toggle group — sound is a cross-cutting, session-wide concern (like
the GPS ribbon toggle), not owned by any one panel, and this app's own
`TopBar` already hosts exactly this class of always-visible chrome control.
Styled as a `.modebtn`-class button (reusing `TopBar.svelte`'s existing
toggle-group visual language, not inventing a new one), with four visual
states:

| State | Appearance | Meaning |
|---|---|---|
| Not yet enabled | Neutral/grey, "🔈 Enable Sound" | Default on every fresh load — `AudioContext` starts `suspended` and no browser will let this app skip that regardless of any remembered preference |
| Enabled — full | Bright/accent | Tone + local-voice speech both available and armed |
| Enabled — degraded | Bright/accent + small `#c22` badge (same warning color `TopBar`'s own elevation-out-of-bounds flag and `ContactsPanel`'s terrain-obstruction flag already use) | No usable local voice found (§5.2/§6.4) — tone-only, informational events fall back to on-screen text |
| Muted | Slash icon | User explicitly silenced everything after enabling |

### 4.2 The button is the test, not a separate hidden step

Clicking "Enable Sound" from the not-yet-enabled state does, in one
synchronous gesture-driven action (Candidate B's "the click is the test"
idea, extended to cover both channels rather than speech alone, since tone
is now the load-bearing safety channel):

1. `audioContext.resume()`.
2. Play the actual C2 tone once, immediately — not a generic beep, the real
   sound the user will hear in the field.
3. Play the actual C3 tone once, immediately after.
4. Attempt the local-voice filter/select (§5.1); if one is found, speak
   "Sound warnings enabled." If none is found, set the degraded-mode flag
   and skip straight to informing the user via the badge/tooltip instead.

This is the direct, and really the *only*, mitigation available for most of
§5's failure modes — it belongs at the same visual priority as the enable
control itself, not buried in a submenu, and it is re-runnable at any time
via the same button (a persistent "Test sound" affordance, not a one-shot
gesture that disappears once spent) so the user can re-verify after e.g.
plugging in headphones or changing volume, ideally days before the event,
not for the first time during the partial phases with people watching.

### 4.3 A small popover, not a new panel or a settings-store framework

No settings/preferences/`localStorage` convention exists anywhere in this
codebase yet — this is genuinely greenfield. Keep it minimal rather than
over-building a general-purpose settings abstraction nobody else needs:

- **Two category toggles, not six per-event ones**: "Timing tones" (C2/C3
  only) and "Spoken announcements" (everything else), both **on** by
  default. The litmus test used to settle "how granular" (adapted from
  Candidate C): does the distinction change what the user should physically
  do next? Tone-vs-speech clears that bar — e.g. an observer with others
  nearby may want the device silent verbally but still want the two
  eye-safety tones, or the reverse. Six independent per-contact toggles
  don't clear that bar for a fixed list with three weeks of runway left —
  nobody has a plausible reason to mute C2's tone specifically while
  leaving C3's on.
- **One shared volume control**, scaling both the tones' `GainNode` and
  every `SpeechSynthesisUtterance.volume` together — one mental model, not
  two independent sliders. **Explicit caveat text next to it, always
  visible, not just on hover**: this cannot override a device's hardware
  mute switch, silent/vibrate mode, or system volume at zero —
  `SpeechSynthesisUtterance.volume` and Web Audio gain both only scale the
  app's own signal relative to whatever the system is already outputting.
  An in-app slider sitting at "100%" would otherwise give false confidence
  the app has control it does not have; saying so plainly is the correct
  design, not omitting the control or omitting the caveat.
- **A master mute**, layered above both categories — one tap silences
  everything (e.g., "someone's asleep nearby") without touching the
  category preferences underneath.

Persistence (Phase 2, §6): a single flat `localStorage` key (e.g.
`eclipse-dashboard:sound-settings`) holding
`{ toneEnabled, speechEnabled, volume }`. **Never persist which contacts
have already fired this session** — that must always be re-derived fresh
from `effectiveTime` on load (§3.2's `SchedulerState` starts empty every
page load), so a mid-event page reload can neither replay a warning that
already fired nor permanently suppress one that hasn't. This is a small
enough addition that it should not block Phase 1 if time is short — sane
defaults on every load (both categories on, one click to re-enable) are an
acceptable cost.

### 4.4 What's deliberately *not* offered, and why

- **No per-contact lead-time configuration.** The original `docs/PLAN.md`
  §9 sketch imagined "per-contact, user-set lead times" — this document
  recommends against it for launch: a fixed `PREWARN_LEAD_S = 30` constant
  (§3) is simpler, has no failure mode of its own, and the marginal benefit
  of per-contact tuning doesn't clear the bar against the UI complexity and
  testing surface it would add with three weeks left. Revisit post-event if
  actually wanted.
- **No per-event (six-way) toggles.** Covered in §4.3 — the two-category
  split already covers every plausible real use case.
- **No attempt to detect device-silent/hardware-mute/system-volume state.**
  No web API exposes any of this (deliberately, for fingerprinting
  reasons) — see §5 for why this is a "surface it, don't pretend to solve
  it" case throughout.

---

## 5. Failure modes and mitigations

| # | Failure mode | Mitigation |
|---|---|---|
| 5.1 | A network-backed voice gets silently selected (Chrome/Edge), quietly breaking this app's own zero-runtime-network guarantee the moment the device is actually offline in the field | Architectural: hard-filter to `localService === true` at voice-selection time (§1.5), never fall through to an unfiltered default voice. Actively re-verified with the network adapter physically disabled during the mandatory Phase 0 spike (§6), not just asserted from documentation |
| 5.2 | No local voice exists on the device at all (locked-down image, minimal install, missing language pack) | Detected at enable-time (§4.2 step 4); surfaced as the degraded-mode badge on the TopBar control (§4.1), not a silent no-op. Tone-based C2/C3 warnings are completely unaffected — this is the direct payoff of the hybrid split (§1.4) |
| 5.3 | Voice *enumeration itself* (not just speaking) triggers a network request in Chrome, before any local-voice filtering can even happen client-side | Unverified either way as of this writing — must be checked with DevTools' Network tab open, and again with the network adapter physically disabled, as part of the Phase 0 spike (§6), on the actual field laptop. If confirmed, `SpeechSynthesis` is dropped entirely (not just degraded) and every informational event falls back to on-screen text only; the tone-based C2/C3 warnings are, again, entirely unaffected |
| 5.4 | Autoplay/gesture restriction blocks the first `speak()`/leaves `AudioContext` `suspended` (Chrome, and documented on iOS Safari as needing the *first* `speak()` synchronously inside a user gesture) | The mandatory Enable-Sound click *is* the unlock gesture and, per §4.2, an immediate, personally-audible self-test — failure here is discovered the moment the button is pressed, not during totality. Residual risk: the user never presses it after a reload right before totality — mitigated by making the not-yet-enabled state visually loud (§4.1), not a subtle icon shade |
| 5.5 | Device on silent/vibrate/DND (mobile) — the hardware mute switch silences web audio output on at least iOS Safari, with no web API able to query that switch's state | **Not detectable by any web API, full stop.** The only available mitigation is forcing discovery *before* totality via the Test Sound re-run (§4.2), with explicit copy near the control: "test this at the volume/silent-switch position you'll actually use in the field." Not fixable in code, and this document says so plainly rather than implying otherwise |
| 5.6 | System/hardware volume at zero (laptop) | Same category, same mitigation as 5.5 — no cross-browser API exposes real system volume level, deliberately (fingerprinting risk) |
| 5.7 | Tab backgrounded / screen dimmed or locked during totality — the OS may throttle JS timers and/or suspend `AudioContext`/`SpeechSynthesis` entirely once the screen is actually off (not just dim), which would mean nothing fires at all, the exact scenario this whole feature exists to prevent | Largest single risk in this design, independent of any tone-vs-speech question. Acquire `navigator.wakeLock.request('screen')` in Phase 1 (graceful no-op fallback on unsupported browsers — historically inconsistent on iOS Safari, so this reduces rather than eliminates the risk) **and** pair it with explicit, always-visible field-guidance copy near the Enable control: keep the screen on and the tab foregrounded, dim brightness rather than letting the OS auto-lock. Note the brief's own framing is "dimmed... not looking at it," not "locked" — a merely-dimmed, still-on, foregrounded tab is a materially lower-risk case than an actually locked/sleeping device, and the copy should say so rather than implying the risk is uniform |
| 5.8 | `AudioContext` re-suspending mid-session after a period of silence (documented on some browsers, Safari especially) even after an initial `resume()` | Defensive `resume()` call (cheap, idempotent) immediately before every scheduled tone play, not just once at arm-time (§3.3) |
| 5.9 | Overlapping/stale queued speech utterances (a sim scrub landing awkwardly, or two informational events close together) | `cancel()` before queuing any new time-sensitive utterance, plus the scheduler's own `fired`-set dedup and jump-collapse logic (§3.2) already prevent most of the plausible triggers |
| 5.10 | Chrome's documented long-continuous-speech-pause / post-backgrounding staleness bug (engine goes quiet, needs a `.cancel()` kick to recover) | Low risk given this app's short utterances (a few seconds each, well under the documented ~15s threshold). Hardened later (Phase 2, not built preemptively) via a periodic no-op `resume()`/`cancel()` nudge while armed, only if field rehearsal actually surfaces it |
| 5.11 | Sim mode left on accidentally during real field use | Considered and deliberately **not** specially guarded beyond what already exists: `TimeBar.svelte`'s Live/Sim distinction and `TopBar.svelte`'s `.simbadge` are already visually unmissable, and — critically — the browser's own autoplay-gesture requirement (§5.4) already forces a fresh, conscious "Enable Sound" click every page load regardless of any persisted preference, at which point the current Live/Sim state is already on screen. A separate non-persisted sim-arming opt-in (as Candidate A proposed) would add real UI complexity to guard against a scenario the existing per-session gesture requirement already substantially covers — rejected as unnecessary given that overlap |
| 5.12 | Underlying clock accuracy (system clock, or GPS-disciplined offset) is itself wrong | No new risk introduced and no additional protection — sound warnings inherit whatever accuracy `effectiveTime` already has, exactly like every other on-screen countdown |
| 5.13 | False confidence from the feature's own existence — once sound warnings exist, a user may stop glancing at the screen entirely, raising the stakes of any unnoticed failure from 5.1–5.10 above what they were before the feature existed | Not fixable in code. Framed explicitly in UI copy as a supplement, not a replacement, and the Test-Sound re-run (§4.2) is kept a persistent, easily-repeatable affordance rather than a one-shot step to encourage actually re-checking it, not just remembering to once |
| 5.14 | `file://` or `localhost` behaves differently than expected for either API — this app has been burned by exactly this class of surprise before (ES module scripts refused entirely from `file://`) | Not assumed either way for either API. Add explicit `file://` + `serve-field.cmd` localhost coverage, on the actual field laptop and at least one Android device, to `docs/PLAN.md` §12's existing manual e2e checklist (already lists "sound arming across browsers (Chrome/Edge)") — verify directly, same discipline already applied to the DEM/horizon work |

---

## 6. Implementation phasing

Given ~23 days of runway, essential-vs-nice-to-have is a real, load-bearing
distinction here, not a formality.

**Phase 0 — mandatory verification spike, done *before* any other sound
code is written (recommend ~half a day):** Build a small throwaway harness
that enumerates `getVoices()` (handling the async `voiceschanged`
population, §6.4) and prints `{name, lang, localService}` for every voice
found, run on the actual field laptop and at least one Android phone, each
combination tested via `file://` and via `serve-field.cmd`'s localhost
path, **each with the network adapter physically disabled**, with DevTools'
Network tab open specifically to check whether mere enumeration (not just
speaking) ever triggers a request (§5.3). **Decision gate, stated plainly:**
if this finds zero usable local voices, or finds that enumeration itself
makes an unavoidable network call, on the actual target hardware —
`SpeechSynthesis` is dropped from the design entirely (not degraded, gone),
every informational event falls back to on-screen text, and Phase 1 ships
tone-only for C2/C3 with text-only for everything else. This is a real
possible outcome of this design, not a formality to rubber-stamp before
moving on, and the hybrid architecture (§1.4) means nothing else about the
plan needs to change if it happens.

**Phase 1 — the field-usable core (essential, target: complete well before
Aug 12):**

- `app/src/eclipse/schedule.ts` (`observableEvents`) and
  `app/src/sound/eligibility.ts` (`soundEligibleEvents`, layering the
  sunset-terminal and Max-suppression rules, §2.3) — both pure, both fully
  unit-tested against fixtures (§7) before anything else is built on them.
- `app/src/sound/scheduler.ts` — the pure crossing-detection reducer
  (§3.2), unit-tested against synthetic tick sequences covering forward,
  backward, and multi-event-jump cases.
- `app/src/sound/tones.ts` — C2 (rising sweep) and C3 (falling, faster/
  more urgent sweep) envelope specs as plain data, per §1.1's frequency
  reasoning; `app/src/sound/audioEngine.ts` — the thin, deliberately
  untested `AudioContext`/`oscillator`/`resume()` glue (same "keep it
  thin, untested surface stays small" convention `connection.ts` already
  established for this codebase's other real-hardware-facing glue).
- `app/src/sound/voices.ts` (pure local-voice filter/preference predicate,
  tested) + `app/src/sound/phrases.ts` (pure phrase-template functions,
  tested) + a thin `speak()`/`cancel()` wrapper in `audioEngine.ts`,
  gated entirely on Phase 0's outcome.
- `app/src/stores/soundWarnings.ts` — the reactive layer: subscribes to
  `effectiveTime` and `soundEligibleEvents(localCircumstances)`, drives
  the scheduler each tick, calls into `audioEngine.ts`. Re-arms
  automatically on any `observer`/`localCircumstances` change (§3.5) for
  free, since it's derived from stores that already do.
- `app/src/lib/SoundControl.svelte` — the TopBar button (§4.1/4.2): four
  visual states, resume + tone self-test + speech self-test on first
  click, re-runnable Test Sound, master mute. **No category toggles, no
  volume slider, no `localStorage` persistence yet** — a single master
  mute is enough for Phase 1; the finer controls are Phase 2.
- `navigator.wakeLock.request('screen')` acquisition (graceful no-op
  fallback) + the field-guidance copy (§5.7) — in Phase 1, not deferred,
  because a screen that's actually allowed to sleep can silently defeat
  every other part of this design at once, and the API is cheap and
  well-supported enough (Chrome/Edge; partial on Safari 16.4+) that there's
  no good reason to wait.
- All six events from §2.1's table, fully wired — the marginal cost of
  wiring C1/Max/C4/Sunset once the shared eligibility function and the
  speech wrapper both exist is small (each is one more data-driven table
  row, not new mechanism), so there's no reason to hold any of them back
  to a later phase once the core exists.

**Phase 2 (only if time remains after Phase 1 is field-verified):**

- The two category toggles ("Timing tones" / "Spoken announcements"),
  shared volume slider with its caveat copy, `localStorage` persistence of
  preferences (never fired-flags) — §4.3.
- Degraded-mode polish (richer tooltip copy explaining *why* it's
  degraded, not just that it is).
- The Chrome long-utterance/post-backgrounding `.cancel()`-kick workaround
  (§5.10) — only if field rehearsal actually surfaces it as a real problem,
  not preemptively.
- Extending sound coverage to the global-circumstances table rows, per
  `docs/PLAN.md` §9's own already-noted future extension ("Eventually
  extend the sound-warnings toggle... to cover entries in this table too,
  not just local contacts").

**Phase 3 / explicitly deferred, named so it isn't silently dropped:**

- Per-event (six-way) toggles beyond the two categories — explicitly
  rejected as unnecessary complexity for this app's actual use case (§4.3),
  not merely postponed.
- Configurable per-contact lead times — the original `docs/PLAN.md` §9
  sketch's idea, explicitly revised against for launch (§4.4).
- A periodic soft "heartbeat" tick throughout totality (considered,
  matching Candidate A's own treatment of the same idea) — real added
  scheduling complexity during the one window where a mistake matters most,
  for a benefit nobody asked for. Worth naming so a future implementer
  knows it was considered and set aside on purpose, not overlooked.
- Richer tone timbre (layered harmonics beyond a single oscillator) — pure
  polish; the plain two-oscillator design is already reliable and distinct
  enough to do its actual job.

No `NOTICE.md` entry is needed for any of this, unlike the DEM-tier work —
neither Web Audio synthesis nor OS-provided local voices bundle any
third-party asset or data.

---

## 7. Testing strategy

Matching this codebase's existing convention exactly: pure logic gets real
`vitest` coverage (`horizon.test.ts`, `elevationFine.test.ts`,
`localCircumstances.test.ts`, `nmea.test.ts`/`nmeaFix.test.ts`/
`monitor.test.ts` are the precedents); anything touching a real
`AudioContext`, `SpeechSynthesis`, or actual hardware audio output is
manual/live-verified only, the same split `docs/GPS-MONITOR-PLAN.md` §8
already draws for `connection.ts`'s `navigator.serial` glue.

### 7.1 Unit-testable (no DOM/audio/speech mocking needed)

- **`eclipse/schedule.ts`'s `observableEvents()`**: fixtures covering
  all-null (no eclipse at all here), no-totality (`c2`/`c3` null,
  `c1`/`c4` present), sunset-before-`c1` (nothing observable at all except
  sunset itself), sunset-between-`c1`-and-`c2` (skips straight to sunset,
  matching `CountdownPanel.svelte`'s own documented behavior), and the
  ordinary fully-observable case. Cross-check output against what the
  *current* triplicated logic in `CountdownPanel`/`ContactsPanel`/`TimeBar`
  would each independently produce for the same fixtures, as a regression
  guard that the extraction is actually faithful before anything else
  depends on it.
- **`sound/eligibility.ts`'s `soundEligibleEvents()`**: the sunset-
  terminal-only rule (`sunset` well after `c4` → dropped; `sunset` before
  `c4` → kept with both tiers; `sunset` before `c2` → kept, `c2`/`c3`/`c4`
  entries themselves absent per `observableEvents()`) and the Max-
  suppression rule (both `c2`/`c3` observable → `max` dropped; either null
  or past sunset → `max` kept) as explicit, separately-named test cases —
  each is exactly the kind of edge case this document made a deliberate,
  reasoned call on (§2.3), so each deserves its own named test rather than
  incidental coverage.
- **`sound/scheduler.ts`'s pure reducer**: feed synthetic `curMs` sequences
  directly, no real timer — forward single-crossing (fires exactly the one
  event), forward multi-crossing in one step (fires only the most-recent,
  silently marks the rest fired — the exact sim-fast-forward case), backward
  scrub (clears `fired` for everything after the new instant, doesn't fire
  anything itself), and a scrub-back-then-forward-again round trip (the
  same event fires twice, once per forward crossing) — this last case is
  the concrete regression test for "rehearsal in sim mode is actually
  useful," not just a nice property.
- **The short-totality guard (§3.4)**: `durationS` values just above/below
  the 40s threshold, confirming the pre-warning is skipped exactly at the
  boundary this document specifies and not off by a tick.
- **`sound/voices.ts`'s filter predicate**: given a synthetic array of
  `{name, lang, localService}` voice objects (no real `SpeechSynthesis`
  needed — this is a plain array filter/sort), confirm `localService:
  false` entries are always excluded and an `en`-tagged local voice is
  preferred over a non-`en` one when both exist, per the fallback ordering
  in §5.1/§6.1.
- **`sound/phrases.ts`'s templates**: pure string-generation functions
  (e.g. the C2 pre-warning phrase given a context) — trivial but cheap to
  pin down exactly, and useful as a regression guard against an accidental
  wording change later touching the eye-safety-relevant lines.

### 7.2 Necessarily manual/live-verified

- **Actual audio output correctness** — do the C2/C3 tones actually sound
  distinct from each other, is the "more urgent" C3 tempo actually
  perceptible, is spoken text actually intelligible at field volume on the
  real hardware. No amount of unit testing substitutes for a human ear
  here.
- **The Phase 0 voice-enumeration/network spike itself (§6)** — inherently
  a real-hardware, real-DevTools, network-adapter-physically-disabled
  exercise; nothing about it can be simulated in `vitest`/`jsdom` (there is
  no real `speechSynthesis` there at all).
- **`AudioContext`/`SpeechSynthesis` autoplay-gesture behavior** across
  Chrome/Edge, `file://` vs. `serve-field.cmd`'s localhost path — add to
  `docs/PLAN.md` §12's existing manual e2e checklist alongside its current
  "sound arming across browsers (Chrome/Edge)" line, on both Windows and at
  least one Android device.
- **`navigator.wakeLock` actual effectiveness** — whether the screen
  genuinely stays on, and whether background timer/audio throttling still
  occurs despite it, needs a real field rehearsal (screen dimmed, tab
  backgrounded briefly, phone locked briefly) rather than a synthetic test.
- **Device silent/hardware-mute/system-volume state** — explicitly
  **untestable by any method, automated or manual-in-code**, per §5.5/§5.6;
  the only "test" that exists is a human physically checking their own
  device before the event, which is exactly what the Test-Sound control
  (§4.2) exists to prompt.

### 7.3 Non-regression discipline

Whichever PR lands Phase 1 should confirm the existing test suite is still
100% green and, ideally, that `CountdownPanel.svelte`/`ContactsPanel.svelte`/
`TimeBar.svelte`'s own diffs are empty (not just behaviorally unchanged —
literally untouched) in that same change, matching
`docs/GPS-MONITOR-PLAN.md` §8's own explicit precedent for a safety/product-
critical path that a new feature must not perturb. The three-way migration
onto `observableEvents()` is real, worthwhile follow-up work — just not in
the same change that introduces sound warnings, per §2.2's own reasoning
about keeping this change's blast radius matched to what it actually needs
to touch.
