# Sound Warnings — Plan

Status: **Phase 1 (§6) implemented and live-verified, 2026-07-21.** All of
`app/src/eclipse/schedule.ts`, `app/src/sound/{eligibility,scheduler,tones,
voices,phrases,audioEngine}.ts`, `app/src/stores/soundWarnings.ts`, and
`app/src/lib/SoundControl.svelte` (wired into `TopBar.svelte`) exist, are
unit-tested (scheduler/eligibility/phrases/tones/voices — 323 tests total
across the app), and pass `svelte-check`. Live-verified in-browser: real
`AudioContext` oscillator scheduling (three tones staggered exactly
`durationS` apart), real local-voice enumeration/selection/`speak()`, mute/
unmute, and a full forward sim-scrub through C1→C2→Max→C3→Sunset with zero
console errors. An adversarial review of `stores/soundWarnings.ts` (the one
new, not-independently-tested reactive glue module) caught and fixed a
real, ship-blocking bug before commit: the §3.5 re-arm trigger compared the
eligible-events array by *reference*, and `localCircumstances` emits a
fresh array on every `observer` update — which `serial/connection.ts`'s
`flushFix()` does roughly once a second, unconditionally, for the entire
duration of a live GPS-connected session regardless of whether the fix
actually moved. That made the scheduler reset (and thus never fire
anything) on nearly every tick specifically in the app's primary intended
field-use mode. Fixed by comparing a value-based, second-rounded key
instead of array identity, and by having a genuine re-arm preserve
`lastEffectiveMs` (only clearing `fired` and cancelling pending tones)
rather than collapsing the tick's own crossing-detection window to zero
width. Confirmed live: 15 repeated `setObserver` calls at an unchanged
position produced zero extra resets; 5 genuinely different positions
produced exactly 5.

**Update, 2026-07-21 (same day): user field-tested Phase 1 and reported
"the sounds systematically come about 1-2s too late."** Investigated via a
diagnostic workflow (parallel code-trace, external latency research, and
an independent re-audit of the re-arm fix above for a possible regression
— cleared, no regression) plus direct live-browser measurement. Two real,
independent causes found and fixed, both in `audioEngine.ts`/
`soundWarnings.ts` only — §3.2/§3.4/§3.5's pure logic was not at fault (the
re-arm fix's own re-audit and a standalone real-time scheduler replay both
confirmed the crossing-detection math is exact):

- **Tone channel**: `playTone()` called `void c.resume()` (fire-and-forget)
  and read `audioContext.currentTime` on the very next synchronous line.
  Per the Web Audio spec, `currentTime` freezes while `suspended` and does
  NOT catch up once resumed — it keeps advancing from wherever it froze.
  Live-measured: after a 5s gap requiring a real resume, `currentTime` had
  drifted ~873ms behind real elapsed wall-clock time. Fixed: `playTone` is
  now `async` and always `await`s `resume()` before reading `currentTime`
  (see the follow-up update below for a correction to this fix's first
  version, which briefly broke sim mode).
- **Speech channel**: had ZERO onset-latency compensation of any kind —
  §3.3's original assumption ("tens to a few hundred ms... irrelevant") was
  wrong. Live-measured on the actual field machine (Windows/Chrome,
  "Microsoft David" SAPI voice): real `speechSynthesis.speak()` onset
  latency of **1.0–1.8 seconds**, confirmed as the dominant cause of the
  report (there are far more spoken rungs than tones per contact, so this
  is what a user mostly notices). Also discovered: the engine "cools down"
  between calls spaced more than ~30-45s apart (a 46.5s-gapped call showed
  ~966ms latency, close to cold-start) but stays fast for rapid
  back-to-back calls (<1s apart) — since real countdown rungs are spaced
  5s to 10+ minutes apart, a single COLD measurement is actually
  representative of real use, not a systematic overestimate. Fixed: added
  `speakAndMeasureLatency()` to `audioEngine.ts`, which times the EXISTING
  "Sound warnings enabled." confirmation utterance's own `onstart` event
  during `enableOrTestSound()` (no extra utterance added to §4.2's
  documented sequence) and stores the result (+ a flat 300ms safety
  margin, erring toward firing early rather than late — the safer
  direction for the "filters off/on" cues specifically) as `speechLeadS`.
  `soundWarnings.ts`'s arm-ahead mechanism (§3.3) was generalized to also
  fire speech-channel rungs up to `speechLeadS` seconds before their
  nominal instant, the same way tones are armed ahead via the audio clock
  — clamped to 3s max, comfortably under the ladders' own tightest
  consecutive-rung gap (5s), so compensation can never reorder or collide
  two rungs. This is a best-effort, measured compensation, not a
  guarantee — SpeechSynthesis has no audio-clock-equivalent scheduling
  primitive, so residual error (typically now within a few hundred ms,
  sometimes firing slightly early) remains, unlike the tone channel's
  audio-clock precision.

Not yet done: the rest of Phase 2 (§4.3's shared volume slider) and Phase
0's Android pass (deferred by user choice, tracked in `docs/PLAN.md` §12).
`docs/STATUS.md` should be updated to drop the "zero code" framing for
this feature.

**Update, 2026-07-21 (same day, again): a real sim-mode regression from the
latency fix above, then a direct request superseding §4.4's per-event
rejection.** Two follow-ups landed after the latency fix:

1. **Regression caught by the user ("Max did not happen, also no tones
   (except for the test sound button)")**: the tone-channel latency fix
   had changed `playTone()` to take an ABSOLUTE target timestamp and
   compute the delay against `Date.now()` — correct in live mode, but a
   real bug in sim mode, where `effectiveTime` can be weeks away from
   `Date.now()` (an event's own Aug-12 Date compared against the real
   July-21 "now" produced a multi-week "delay," so nothing in sim mode
   ever actually played). Reverted `playTone()` to a RELATIVE `delaySec`
   (matching its original, already-correct design) computed by the
   caller against whatever clock is authoritative (`curMs`, sim or live),
   while keeping the real fix (always `await resume()` before reading
   `currentTime`) by measuring elapsed real time during any such await
   with `performance.now()` (monotonic, unaffected by either `Date.now()`
   or the app's own simulated clock) and subtracting it from `delaySec`.
   Live-verified: full sim-mode playthrough with instrumented
   `oscillator.start`/`speechSynthesis.speak` calls, zero console errors.
2. **Direct request, superseding §4.4's "no per-event toggles... no
   plausible use case" decision**: the user asked for a list of every
   individual sound event with the ability to disable/re-enable it and
   edit its spoken text, in a new view that replaces the Timetable panel
   when toggled (not integrated into it, and not the category-level
   toggle §4.3 had sketched). Built as `app/src/stores/soundOverrides.ts`
   (a `{disabledIds, phraseOverrides}` store, persisted to
   `localStorage` under `eclipse-dashboard:sound-overrides` — the first
   persisted preference this feature has, ahead of §4.3's own planned
   persistence), applied inside `stores/soundWarnings.ts`'s
   `eligibleEvents` derived (filters disabled ids out of the array
   entirely, remaps `phrase` for overridden ones) before anything reaches
   the scheduler, `app/src/lib/panels/SoundConfigPanel.svelte` (the new
   view — one row per event, grouped by C1/C2/Max/C3, a per-row on/off
   toggle and click-to-edit phrase text with a reset-to-default), and a
   new `soundConfigVisible` boolean in `stores/layout.ts` toggled from a
   small icon button in the 'timetable' pane (both `ContactsPanel` and
   `SoundConfigPanel` stay permanently mounted, one hidden via
   `display:none` — same rationale as the existing fullscreen-panel
   convention, here specifically preserving an in-progress phrase edit
   across visibility toggles). An adversarial review confirmed disabling
   an already-armed tone correctly triggers the existing re-arm/cancel
   path (removing an id changes `eventsKey()`'s hash, which was already
   how an observer move triggers the same reset), and that phrase edits
   are always read fresh at the moment an event actually fires (no stale
   captured text). Live-verified in-browser: toggling an event off/on,
   editing and resetting a phrase, and switching back to the normal
   Timetable view, all with zero console errors and correct persistence.
   §4.4's rejection of this granularity is superseded for this specific,
   explicitly-requested case — the category-level toggle and volume
   slider from §4.3 remain undone and are no longer the planned next step
   for "control granularity," since per-event control now exists instead.

This document was originally the
synthesis of three independently-written design candidates (pure synthesized
tones, speech-first via Web Speech API, and a deliberate tone+speech hybrid)
into one implementation-ready plan; §1-§2's event/message content was then
**revised 2026-07-21 per direct instruction, in two passes** — first
replacing the synthesis's original single-T−30s-pre-warning design with a
richer per-event countdown ladder (§2.1), then a follow-up settling what
that first pass had left open (§2.4): C4/Sunset get no sound at all, Max's
announcement is unconditional (no more totality-redundancy suppression),
the Filters off!/on! calls are folded into C2's own 15s rung and a new
standalone C3+15s event rather than two separate not-yet-timed events, and
C1/C2/C3's tones are deliberately identical for now, to be differentiated
later. The underlying architecture (hybrid tone+speech split, scheduler,
voice-filtering guardrail) is unchanged and still applies throughout. Every
claim about this app's own architecture below (`localCircumstances`,
`effectiveTime`/`now`, `horizonObstruction`, and the actual triplicated "next
observable event" logic) was checked directly against the current source,
not assumed. T−23 days at time of writing (2026-08-12, ~18:26–18:33 UT,
Spain).

---

## 1. Approach and why

**Recommendation: a hybrid — Web Audio oscillator tones own the three
hard-deadline eye-safety instants (C1, C2, C3), and local-voice-only
`SpeechSynthesis` owns everything else, including each of their countdown
ladders (§2.1).** No event ever gets a tone-only or speech-only treatment by
default except that C1/C2/C3 trio, which gets tone at the exact instant with
no concurrent speech (the ladder beforehand already named what's coming —
§1.3). This is closest to Candidate C's thesis, deliberately narrowed and
corrected in a few places where reading candidates A and B closely exposed
real gaps in C's own execution (§1.4) — then widened from C2/C3-only to
C1/C2/C3 in the 2026-07-21 revision above.

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
and it is decisive for every event except the three where reaction speed, not
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
that by putting the tone in Phase 1 from the start (§6) for all three
eye-safety instants (C1/C2/C3 per the 2026-07-21 revision) — it is not an
enhancement layered onto speech, it is the load-bearing part.

### 1.3 Why hybrid, and why this specific division of labor

The real insight (Candidate C's, and the reason this document leans on C's
frame more than A's or B's) is that "precise reaction cue" and "context/
naming" are not two ends of one dial to compromise between — they are two
different *jobs*, and this app's six events split cleanly across them with
no overlap:

- **C1 (partial begins), C2 (totality begins), and C3 (totality ends)** are
  the three moments where a specific physical action (filter on / filter
  off / filter back on) is tied to the *exact* instant, and where getting
  the instant wrong by more than a couple of seconds has a real eye-safety
  cost. **Revised from this document's original cut** (which reserved tone
  for C2/C3 only, reasoning C1 had no hard deadline) **per direct
  instruction** — C1 gets a tone too, on the same footing as C2/C3, since
  the filter must already be on by C1 exactly as it must come off/on at
  C2/C3. All three need a signal immune to platform TTS engine variance,
  `.speak()`'s tens-to-hundreds-of-ms startup latency, and its FIFO
  (non-overlapping) queueing behavior — properties no `SpeechSynthesis`
  call can fully escape even after voice filtering, because they're
  inherent to the API, not a bug in some browser's implementation. Web
  Audio oscillators sidestep all of it: `oscillator.start(audioContext
  .currentTime + delta)` is honored by the browser's own audio-rate clock,
  immune to main-thread jank, GC pauses, or `setInterval`/`setTimeout`
  throttling.
- **Max** — unconditional per §2.3 Rule 3 — is informational: "here's how
  much of the disk is covered." No hard deadline measured in fractions of a
  second, so spoken, not toned. (**C4 and Sunset get no sound treatment at
  all**, per §2.3 Rule 1 — they're not part of this "spoken, not toned"
  bucket or any other; they simply produce no `SoundEvent`.)
- **The countdown ladders for C1/C2/C3 themselves** (§2.1) are also
  informational ("something precise is coming soon") rather than the
  precise cue itself — so every rung is spoken, not toned, and naming what
  it's counting down to is exactly the job speech is better at. Unlike this
  document's original single-T−30s-pre-warning design, a multi-rung ladder
  reintroduces a real version of the queueing risk Candidate B hit (§1.2):
  adjacent rungs can sit as close as 5s apart (e.g. C2's 15s/10s/5s marks),
  which is enough for a slow TTS engine to still be mid-utterance when the
  next rung fires. Mitigation (§6.4/§7.2): `speechSynthesis.cancel()`
  immediately before queuing each new rung, same discipline already needed
  for §5.9's overlapping-utterance case — an interrupted "fifteen seconds"
  cut off by "ten seconds" a moment later is a far smaller cost than a
  queued backlog of stale countdown lines reading out after the fact.

### 1.4 Why this degrades better than either pure candidate

Because the tone half has zero dependency on the speech half succeeding,
this design's failure mode is strictly better than a speech-primary
design's: if the Phase 0 voice-filtering spike (§6, mandatory, done first)
finds no usable local voice on the actual field hardware — or, worse, finds
that mere voice *enumeration* triggers a network call that can't be avoided
(a real, specific risk Candidate B raises and this document treats with the
same seriousness, §5.3) — the result is graceful: informational events fall
back to tone + on-screen text, while C1/C2/C3's tone-based safety cues are
completely unaffected, because they never depended on speech in the first
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

### 2.1 The events, and which channel(s) they get

**Revised 2026-07-21, per direct instruction (twice — the countdown-ladder
revision, then a second pass settling the items §2.4 had left open).** All
keys come from `LocalCircumstances`
(`app/src/stores/localCircumstances.ts`): `c1, c2, max, c3, c4, sunset`, all
independently nullable except `max` — but as of this second revision, only
`c1, c2, max, c3` ever get any sound at all (see C4/Sunset below). No event
in this design ever reads a `Date` field without checking it for `null`
first — every rung below is gated by the eligibility rules in §2.2/§2.3
before it's ever considered "armed."

**C1 — partial eclipse begins** (solar filter must already be on). Spoken
countdown, exact wording per rung — **a deliberate choice, not an
inconsistency**: the "to C1"/context framing drops on the last two rungs,
but "seconds" itself is kept on all of C1's sub-minute rungs (contrast
C2/C3 below, where "seconds" itself drops too, further in):
  - 5 min: *"Five minutes to C1."*
  - 1 min: *"One minute to C1."*
  - 30s: *"Thirty seconds to C1."*
  - 10s: *"Ten seconds."*
  - 5s: *"Five seconds."*
- At C1: **Tone** only — no separate spoken confirmation; the ladder above
  already named what's coming, so the tone is purely the precise click

**C2 — totality begins** (filter comes off). Spoken countdown — here both
the "to C2" framing *and* the word "seconds" itself drop on the closest
rungs, a tighter progression than C1's:
  - 10 min: *"Ten minutes to C2."*
  - 5 min: *"Five minutes to C2."*
  - 2 min: *"Two minutes to C2."*
  - 1 min: *"One minute to C2."*
  - 30s: *"Thirty seconds."*
  - 15s: *"Fifteen, filters off!"* — folds the filter-safety instruction
    directly into this rung instead of a separate event (settled
    2026-07-21, replacing the original "separate `Filters off!` call at
    C2 − *X*, X TBD" design — there is no separate event any more, X is
    simply 15 and it *is* this existing rung, reworded)
  - 10s: *"Ten."*
  - 5s: *"Five."*
- At C2: **Tone** only

**Max — greatest eclipse**:
- No pre-warning (nothing actionable to prepare for)
- At Max: Spoken *"Maximum."* — **unconditional, settled 2026-07-21**,
  repealing this document's original suppression rule (§2.3's former
  Judgment call 3, which silenced Max whenever C2/C3 were both observable)
  — Max now announces even during an otherwise-fully-observable totality

**C3 — totality ends** (filter goes back on). Spoken countdown — same
tight, "seconds"-dropping progression as C2's closest rungs, just starting
later since totality itself is only ~1-2 minutes long (a 5-minute-out
warning for C3 would be warning about an instant that hasn't even had its
own C2 tone yet at most sites):
  - 50s: *"Fifty seconds."*
  - 30s: *"Thirty seconds."*
  - 15s: *"Fifteen."*
  - 10s: *"Ten."*
  - 5s: *"Five."*
- At C3: **Tone** only
- **New, additional event, settled 2026-07-21**: at C3 **+ 15s** (after,
  not before), Spoken *"Filters on!"* alone — no countdown number, since
  there's nothing left to count down to at that point; a genuinely separate
  `SoundEvent`, not a reworded rung the way C2's 15s rung is (C3's own
  countdown wording above is unchanged, plain)

**C4 — partial eclipse ends** and **Sunset** — **no sound at all, settled
2026-07-21** (repealing this section's original carried-forward "spoken-only
at-instant" treatment for both). Neither gets a `SoundEvent` of any kind,
regardless of nullability/observability — `sound/eligibility.ts` excludes
both keys outright, unconditionally, before any other rule runs.

Tone is reserved for the three hard-deadline eye-safety instants — C1, C2,
C3 — no event outside those three ever gets a tone, in any phase, keeping
the "Timing tones" UI toggle (§4.3) a well-defined control over exactly
three sounds. **All three tones are deliberately identical for now** (a
single simple placeholder shape, not the distinct rising/falling sweeps
this document originally sketched for C2/C3) — differentiating them is
explicit future iteration, not part of this plan's Phase 1 scope (§6).

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

### 2.3 Sound-specific layering on top of `observableEvents()`

`observableEvents()` above is a faithful port of what the three existing
UI consumers *already* do — it is not sound-specific. Sound warnings need
sound-specific filtering on top, in a new **`app/src/sound/eligibility.ts`**.
This section originally made three judgment calls here; **two of the three
were superseded 2026-07-21** by simpler, explicit rules — kept below with
the repeal noted rather than silently deleted, since the reasoning that led
to the original calls is still worth having on record.

**Rule 1 — C4 and Sunset get no sound at all, unconditionally (settled
2026-07-21, repeals the original "sunset only gets a warning when terminal"
judgment call).** Neither key ever produces a `SoundEvent`, regardless of
nullability or `observableEvents()`'s own output — `soundEligibleEvents()`
excludes both outright, before any other rule runs. *(The original,
superseded rule reasoned about a "sunset only when it actually ends the
event" cutoff, mirroring `ContactsPanel.svelte`'s own table logic — no
longer applicable now that sunset gets no sound treatment in any
circumstance. That original rule was also explicitly a different "sunset is
special" carve-out from the unrelated one already in `horizonObstruction.ts`
— that store's `CONTACT_KEYS` computation excludes `'sunset'` from its own
obstruction flag because the near-0° threshold trips almost everywhere and
isn't an actionable terrain signal, per `docs/HORIZON-PLAN.md`. Worth
remembering these were always two independent carve-outs, not the same
rule twice, in case either is revisited later.)*

**Rule 2 — terrain obstruction never suppresses a sound warning, for any
event, ever (unchanged).** Unanimous across all three original input
candidates, and correct for two independent reasons: first,
`horizonObstruction`'s `ContactObstruction.obstructed` flag is a DEM-based
*prediction*, not a certainty — `docs/HORIZON-PLAN.md` §3.1 already states
plainly that no bare-earth DEM sees trees, buildings, or the exact hillock
the observer ends up standing behind, so silently withholding the most
safety-critical warning (C3) on a possibly-wrong prediction is a bad trade
even before considering the second reason. Second, and more fundamental:
the entire premise of an audible warning is that the user *isn't* looking
at the sky to personally judge visibility right now — so
visibility-to-the-eye and relevance-to-the-ear are orthogonal properties,
and a user might still care about exact timing (photography, narrating to
a group, other instruments) regardless of whether the Sun itself happens to
be behind a ridge at that moment. **Concretely: `soundEligibleEvents()`
never reads `horizonObstruction` at all** — it has no input from that
store, by construction, so there is no code path by which it could
accidentally suppress a warning based on a terrain prediction.

**Rule 3 — Max always gets its spoken announcement, unconditionally
(settled 2026-07-21, repeals the original "suppress Max when C2/C3 are both
observable" judgment call).** The original rule suppressed Max whenever a
normal, fully-observable totality was happening, reasoning C2/C3's own cues
already said "this is the big moment" and a mid-totality "maximum eclipse
now" would be redundant competing noise. Direct instruction overrides that
reasoning: Max is wanted even during an otherwise-fully-observable totality.
No condition left to encode here — every non-null `max` (which is to say,
every `max`, since it's never null) gets the announcement.

```ts
export interface SoundEvent extends ScheduledEvent {
  channel: 'tone' | 'speech';
  prewarn: boolean; // false = at-instant
}

/** Layers the sound-specific rules above on top of observableEvents():
 * excludes c4/sunset outright (Rule 1), never reads horizonObstruction
 * (Rule 2), and no longer suppresses max under any condition (Rule 3).
 * Assigns each surviving event its channel(s) per §2.1's table. */
export function soundEligibleEvents(lc: LocalCircumstances): SoundEvent[];
```

(Per §2.1's revised table: C1 expands to five countdown-rung `SoundEvent`s
(`channel: 'speech'`, `prewarn: true`) plus one at-instant tone entry
(`channel: 'tone'`, `prewarn: false`). C2 follows the same ladder-plus-tone
pattern but with eight countdown rungs, not five — its 15s rung carries the
folded-in "Fifteen, filters off!" wording rather than a plain countdown
line, still one `SoundEvent`, just with different text, not a separate
event. C3 expands to its own five countdown rungs plus its tone,
**plus one further, genuinely separate `SoundEvent`** at C3+15s for the
standalone "Filters on!" call. Max is a single at-instant speech entry, no
ladder. C4/Sunset produce no entries at all, per Rule 1.)

### 2.4 Open items

**Resolved by the 2026-07-21 follow-up (kept here briefly for the record,
since this section was cited by name elsewhere while these were still
open):** the Filters off!/on! lead/lag times (§2.1: folded into C2's own
15s rung, and a new standalone C3+15s event — no separate *X* to solve
any more), C4/Sunset's treatment (§2.1/§2.3 Rule 1: no sound at all), Max's
suppression rule (§2.3 Rule 3: repealed, always fires), and the tone-shape
question for all three of C1/C2/C3 (§2.1: deliberately identical for now,
differentiation deferred to a later iteration, not a blocking unknown).

**Still genuinely open:**

- **Countdown-ladder queueing risk** (§1.3's closing paragraph) — adjacent
  rungs as close as 5s apart is a real `SpeechSynthesis` overlap risk on a
  slow engine; mitigation identified (`cancel()` before each new rung) but
  not yet load-tested against a real slow-TTS device.
- **`GUARD_BUFFER_S`'s exact value** (§3.4's generalized short-totality
  guard) — 10s carried forward from the original design as a placeholder,
  not confirmed against the new multi-rung ladder.

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
- *Should the C1/C2/C3 tone actually be fired from inside the 1Hz tick
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

**Implementation refinement (found during `scheduler.ts`'s own adversarial
review, before §2.1's Filters off!/on! timing was resolved):** the "more
than one crossed" collapse above must key off the most-recently-passed
**time**, not the most-recently-passed **event** — defensive design for
the case where two `SoundEvent`s ever land on one exact instant. As
currently resolved (§2.1), no two `SoundEvent`s actually share an instant
any more (Filters off! is folded into C2's own 15s rung rather than a
separate same-instant event, and Filters on! sits at C3+15s, distinct from
everything else) — but the fix stays as general robustness against any
future same-instant pairing, since it's not the "skipped through a
rehearsal" case the collapse rule otherwise exists for. `scheduler.ts`
fires every crossed event **at** the latest crossed time (usually one,
occasionally a same-instant pair if one is ever introduced), and only
silently swallows anything strictly **earlier** than that.

### 3.3 What the tone channel does differently once "fire now" is decided

Speech firing was originally designed to be simple: when the reducer says
"fire `c1`'s 30-second countdown rung now" (any ladder rung on any of
C1/C2/C3 — including C2's own reworded 15s "Fifteen, filters off!" rung,
which is just a rung with different text, nothing special about its firing
— or C3's standalone Filters-on! event at C3+15s), call
`speechSynthesis.speak(...)` directly from the tick handler, on the
assumption that its own onset latency ("tens to a few hundred ms") would
be irrelevant against a spoken cue that's already several seconds loose by
design. **That assumption was wrong** — live-measured on a real Windows/
Chrome session, real onset latency was 1.0-1.8 seconds, not "tens to a few
hundred ms" (see this document's top status line, 2026-07-21 update, for
the full investigation). Speech now gets its own best-effort early-fire
compensation (`speechLeadS` in `soundWarnings.ts`, measured once at
enable-time from the confirmation utterance's own `onstart` timing),
mirroring the tone channel's arm-ahead mechanism below but without an
audio-clock-precision guarantee, since SpeechSynthesis has no equivalent
scheduling primitive to arm against.

Each of **C1/C2/C3's own tone** needs the audio-clock precision from §3.1,
which means it can't simply fire "now" from inside a tick that only runs
once a second. **Arming**: once the reducer's lookahead (computed each tick
regardless of whether anything is due *this* tick) shows a `tone`-channel
event — any of the three, not just two — is within `ARM_LEAD_S = 3` seconds
**and the current motion is forward with a plausibly-small delta** (i.e.,
we're in the "zero or one events crossed" regime from §3.2, not a big
jump), compute the precise remaining delta against `effectiveTime` and call
`oscillator.start(audioContext.currentTime + delta)` — the audio clock, not
the next tick, now owns the exact playback moment. Three seconds of lead
comfortably covers the tick's own worst-case ~1s detection jitter with
margin to spare before computing and issuing the precise schedule call.
**Unlike this document's original design, there is nothing to arm
alongside it any more** — §2.1's revision made the at-instant moment
tone-only, with naming handled entirely by the countdown ladder
beforehand, so the tone's own arm step is the whole job here.

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
incidence applies here too. The original single-T−30s design guarded
against one collision case (C3's lone pre-warning landing near C2's tone).
**Generalized for §2.1's revised multi-rung ladder**: a C3 rung with lead
time `L` computes to `C3 − L`, landing `durationS − L` seconds after C2's
tone — for a short enough totality this can land uncomfortably close to
C2's own cue, or even *before* C2 altogether (announcing totality's end
before its start has even happened, nonsensical). **Skip each C3 rung
individually** if `durationS < L + GUARD_BUFFER_S`, rather than an
all-or-nothing cutoff — a moderately-short totality only drops the
longest-lead rung ("fifty seconds to C3") while keeping the close-in ones
that still make sense once C2 has actually passed. `GUARD_BUFFER_S`'s exact
value is **TBD** (10s, matching the original design's own buffer, is a
reasonable placeholder pending confirmation — added to §2.4). C3's
at-instant tone is never skipped by this guard — only the loose,
genuinely-skippable pre-warning rungs are.

### 3.5 Re-arming on observer/location change

`soundEligibleEvents(lc)` recomputes reactively whenever `observer` (and
therefore `localCircumstances`) changes — dragging the map pin, switching
GPS/Browser/Manual/preset, or a GPS fix updating the position. Every time
its output changes, the scheduler's `SchedulerState` is **fully reset**:
new `lastEffectiveMs`, empty `fired` set, any pending `oscillator.start()`
call still scheduled against the *old* location's contact times is
cancelled. New contact times are, for this purpose, entirely new event
instances — never partially reconciled against the previous location's
already-fired flags. This recompute is cheap enough (a linear scan over a
few dozen plain `SoundEvent` entries at most — §2.1's revised ladder pushes
the real per-observer count to roughly 24-26, up from the original design's
≤7, but only ever from discrete, human-paced triggers, never a render loop;
still sub-millisecond, no DOM/geometry/I/O involved) to run unconditionally,
with no debouncing. Note the part of this reset that touches real browser
timers is unaffected by the ladder's size: only `tone`-channel events (C1,
C2, C3 — never more than 3) are ever pre-armed ahead of time (§3.3); ladder
rungs fire directly from the tick, so there's nothing to cancel for them.
`horizonObstruction`'s own precedent for reacting to every observer change
does real DEM/geometry sampling per change — categorically heavier than
this scan even at the larger count.

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
2. Play the actual C1 tone once, immediately — not a generic beep, the real
   sound the user will hear in the field (§2.1's revision added a tone to
   C1, alongside C2/C3).
3. Play the actual C2 tone once, immediately after.
4. Play the actual C3 tone once, immediately after that.
5. Attempt the local-voice filter/select (§5.1); if one is found, speak
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

- **Two category toggles, not a per-event one for every rung**: "Timing
  tones" (C1/C2/C3 only) and "Spoken announcements" (everything else,
  including every countdown-ladder rung), both **on** by default. The
  litmus test used to settle "how granular" (adapted from Candidate C):
  does the distinction change what the user should physically do next?
  Tone-vs-speech clears that bar — e.g. an observer with others nearby may
  want the device silent verbally but still want the three eye-safety
  tones, or the reverse. Per-rung toggles don't clear that bar for a fixed
  ladder with three weeks of runway left —
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
  recommends against it for launch: §2.1's fixed countdown ladders (a
  specific, hand-picked lead-time set per event, not a single shared
  constant any more since the 2026-07-21 revision) are simpler, have no
  failure mode of their own, and the marginal benefit of further per-contact
  tuning on top of an already-rich ladder doesn't clear the bar against the
  UI complexity and testing surface it would add with three weeks left.
  Revisit post-event if actually wanted.
- **No per-rung or per-event toggles beyond the two categories.** Covered in
  §4.3 — the tone/speech category split already covers every plausible real
  use case; muting one specific countdown rung while keeping its neighbors
  has no plausible use case.
- **No attempt to detect device-silent/hardware-mute/system-volume state.**
  No web API exposes any of this (deliberately, for fingerprinting
  reasons) — see §5 for why this is a "surface it, don't pretend to solve
  it" case throughout.

---

## 5. Failure modes and mitigations

| # | Failure mode | Mitigation |
|---|---|---|
| 5.1 | A network-backed voice gets silently selected (Chrome/Edge), quietly breaking this app's own zero-runtime-network guarantee the moment the device is actually offline in the field | Architectural: hard-filter to `localService === true` at voice-selection time (§1.5), never fall through to an unfiltered default voice. Actively re-verified with the network adapter physically disabled during the mandatory Phase 0 spike (§6), not just asserted from documentation |
| 5.2 | No local voice exists on the device at all (locked-down image, minimal install, missing language pack) | Detected at enable-time (§4.2 step 5); surfaced as the degraded-mode badge on the TopBar control (§4.1), not a silent no-op. Tone-based C1/C2/C3 warnings are completely unaffected — this is the direct payoff of the hybrid split (§1.4) |
| 5.3 | Voice *enumeration itself* (not just speaking) triggers a network request in Chrome, before any local-voice filtering can even happen client-side | Unverified either way as of this writing — must be checked with DevTools' Network tab open, and again with the network adapter physically disabled, as part of the Phase 0 spike (§6), on the actual field laptop. If confirmed, `SpeechSynthesis` is dropped entirely (not just degraded) and every informational event falls back to on-screen text only; the tone-based C1/C2/C3 warnings are, again, entirely unaffected |
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

**Phase 0 — mandatory verification spike — DONE, 2026-07-21, decision:
`SpeechSynthesis` is viable, proceed with the full hybrid design.**
`tools/phase0-voice-check.html` (+ `tools/serve-tools.mjs`/
`serve-phase0-check.cmd` for the localhost half, since `serve-field.cmd`
only serves `app/dist/`) enumerates `getVoices()` and prints
`{name, lang, localService}` for every voice found. Run by the user on
their real field laptop, network physically disabled, DevTools' Network
tab open, both via `file://` and via the new localhost server: **at least
4 local (`localService: true`) voices found each time, no network activity
observed in either mode.** Decision gate resolved positive — `SpeechSynthesis`
is not dropped from the design. **Not yet run on an Android phone** (the
user's explicit call, not an oversight) — add to `docs/PLAN.md` §12's manual
e2e checklist as a residual item to check before the event, not a blocker
for continuing Phase 1 now.

**Phase 1 — the field-usable core (essential, target: complete well before
Aug 12) — DONE, 2026-07-21 (see this document's own top status line for the
live-verification summary and the GPS-churn bug caught and fixed during
adversarial review):**

- `app/src/eclipse/schedule.ts` (`observableEvents`) and
  `app/src/sound/eligibility.ts` (`soundEligibleEvents`, layering §2.3's
  rules — C4/Sunset excluded outright, terrain obstruction never consulted,
  Max unconditional) — both pure, both fully unit-tested against fixtures
  (§7) before anything else is built on them.
- `app/src/sound/scheduler.ts` — the pure crossing-detection reducer
  (§3.2), unit-tested against synthetic tick sequences covering forward,
  backward, and multi-event-jump cases.
- `app/src/sound/tones.ts` — one shared envelope spec as plain data, reused
  identically for C1/C2/C3 (§2.1: deliberately undifferentiated for Phase
  1, per direct instruction — distinguishing them is later iteration, not
  built now); `app/src/sound/audioEngine.ts` — the thin, deliberately
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
- All four sound-eligible events from §2.1's table (C1, C2, Max, C3 — C4
  and Sunset get none, per Rule 1), fully wired — the marginal cost of
  wiring Max once the shared eligibility function and the speech wrapper
  both exist is small (one more data-driven entry, not new mechanism), so
  there's no reason to hold it back to a later phase once the core exists.

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
- **`sound/eligibility.ts`'s `soundEligibleEvents()`**: `c4`/`sunset` never
  produce a `SoundEvent` under any fixture, including ones where they'd be
  fully observable per `observableEvents()` (Rule 1) — a direct,
  easy-to-miss-in-a-refactor invariant worth its own explicit test rather
  than incidental coverage. `max` always produces exactly one at-instant
  `SoundEvent`, including the fully-observable-totality case that used to
  suppress it (Rule 3) — equally worth pinning explicitly, precisely
  because it's the kind of "obviously should be conditional" case a future
  edit might reintroduce a condition for without realizing it was
  deliberately removed. `c2`'s 15s rung carries the folded-in
  `"Fifteen, filters off!"` text, distinct from every other rung's plain
  countdown wording. `c3` produces its own extra, separate `SoundEvent` at
  `c3.getTime() + 15_000` for the standalone `"Filters on!"` call, with no
  countdown number.
- **`sound/scheduler.ts`'s pure reducer**: feed synthetic `curMs` sequences
  directly, no real timer — forward single-crossing (fires exactly the one
  event), forward multi-crossing in one step (fires only the most-recent,
  silently marks the rest fired — the exact sim-fast-forward case), backward
  scrub (clears `fired` for everything after the new instant, doesn't fire
  anything itself), and a scrub-back-then-forward-again round trip (the
  same event fires twice, once per forward crossing) — this last case is
  the concrete regression test for "rehearsal in sim mode is actually
  useful," not just a nice property.
- **The short-totality guard (§3.4)**: since each C3 rung now has its own
  threshold (`L + GUARD_BUFFER_S` per lead time `L` — 60s/40s/25s/20s/15s
  given the 10s placeholder), test `durationS` values just above/below each
  rung's own boundary independently, confirming a moderately-short totality
  drops only its longest-lead rungs while keeping the close-in ones, not an
  all-or-nothing cutoff.
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

- **Actual audio output correctness** — do the C1/C2/C3 tones actually sound
  distinct from each other (all three, not just C2 vs. C3), is the "more
  urgent" C3 tempo actually perceptible, is spoken text (including every
  countdown-ladder rung) actually intelligible at field volume on the real
  hardware. No amount of unit testing substitutes for a human ear
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
