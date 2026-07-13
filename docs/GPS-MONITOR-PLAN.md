# GPS NMEA Monitor — Expansion Plan

Status: **planning only — nothing in this doc has been implemented.** No GPS
source file was touched to produce it; this is a design document written
after a read-through of the current `app/src/serial/` + `app/src/lib/Gps*`
code, meant to be picked up in a future session (possibly on another
machine, with no memory of the conversation that produced it) and turned
into actual PRs, phase by phase.

Written the same way `docs/HANDOFF-2026-07-13.md` was written: assume the
reader has not seen this code before and re-derive the important bits from
the source, not from memory of a chat.

---

## 1. What exists today

The current GPS NMEA monitor is a **deliberate first pass** — direct quote
from the session that built it: *"the nmea monitor box is also unusable [as
a small dropdown]... a panel as comprehensive as [a dedicated NMEA monitor
tool] would be nice, but we could start prototyping first with just a few
fields."* That's exactly what's there now, and it works: connect, watch a
handful of fields update, watch the raw stream scroll by.

| File | Role |
|---|---|
| `app/src/serial/nmea.ts` | Pure parser. Parses **GGA** (fix quality, altitude, lat/lon, satellite count, HDOP), **RMC** (date, active/void status, lat/lon), and **GSA** — but only GSA's Mode‑2 field (1/2/3 = no‑fix/2D/3D). Talker ID (GP/GN/GL/GA/GB/…) is deliberately ignored, matched by the sentence's last 3 letters only — see the file's own comment: *"which constellations a receiver reports under isn't this app's concern, only the fix itself."* Everything else (GSV, VTG, GLL, ZDA, HDG, GNS, GSA's PRN list/PDOP/VDOP, …) returns `null`. Fully unit-tested (`nmea.test.ts`, 102 lines) against hand-built + published-example sentences, no `navigator.serial` involved. |
| `app/src/serial/nmeaFix.ts` | Pure reducer: merges GGA+RMC+GSA(fixType) into one running `NmeaFixState` (hasFix, lat/lon/altitude, fixQuality, numSatellites, hdop, fixType, utc). Freezes last-known position on fix loss rather than nulling it. Unit-tested (`nmeaFix.test.ts`, 142 lines). |
| `app/src/serial/monitor.ts` | Pure UI helpers: the raw-line ring buffer (`appendLine`, capacity 40), port label formatting, the epoch-rate tracker (`recordFixEvent`), and fix-quality/fix-type human labels. Unit-tested (`monitor.test.ts`, 136 lines). |
| `app/src/serial/connection.ts` | The real `navigator.serial` glue — the one untested-by-design file (*"keep it thin, untested surface stays small"*, its own comment). `applyLine()` is the per-raw-line entry point: appends every line to `recentLines` unconditionally, parses it, feeds GGA/RMC/GSA into the fix reducer, updates the Hz tracker on GGA, and (throttled, deferred via `setTimeout`) pushes a good fix into the observer store. **All of this runs regardless of whether the monitor panel is open** — `gpsMonitorOpen` only gates whether `GpsMonitorPanel.svelte` is mounted, not whether `connection.ts` does any work. |
| `app/src/lib/GpsMonitorPanel.svelte` | The current monitor UI: connection status, baud, an Hz readout + pulse dot (from GGA arrival timing, with its own staleness detection), a single fields grid (Fix quality, Fix type, UTC, Lat, Lon, Altitude, Satellites, HDOP), and a raw NMEA stream (last 40 lines, stick-to-bottom-unless-scrolled-up). Fullscreen overlay, own boolean store (`gpsMonitorOpen` in `stores/layout.ts`), independent of the 4-panel grid's `fullscreenPanel` mechanism. |
| `app/src/lib/GpsRibbon.svelte` | The second-row control panel: Connect/Connected, baud select, port picker, Freeze, and the "⛶ Monitor" button that opens the panel above. |

Three facts drive everything below:

1. **The core pipeline (GGA/RMC/GSA-fixType → `nmeaFix.ts` → `setObserver()`) is
   safety/product-critical and already field-tested** (see
   `docs/HANDOFF-2026-07-13.md`'s buffer-overrun postmortem — this exact path
   has already had one real bug where doing too much synchronous work per
   line broke serial reads on real hardware). It must not change shape or
   behavior as part of this work.
2. **Nothing about the current code is gated on `gpsMonitorOpen` at the
   parsing level.** The store boolean only controls whether the *component*
   is mounted; `connection.ts` has no concept of "the monitor is open" at
   all today.
3. Test coverage today is 100% pure-function (380 lines across three
   `*.test.ts` files, zero DOM/serial mocking) — the existing convention to
   preserve is: parsers and reducers are pure and tested, `connection.ts` is
   thin and isn't.

---

## 2. The reference tool (target shape, not a phase‑1 target)

The user shared a screenshot of a dedicated third-party "GPS‑NMEA monitor"
desktop tool as the aspirational reference. Transcribed here so this doc
stands alone:

- **GNGGA panel** — UTC, Lat, Lon, Pos Fix ("SPS fix"), Used Sat, HDOP,
  Altitude, Geoid, DGPS age, DGPS‑ID.
- **GNRMC panel** — UTC, Status ("Autonomous"), Lat, Lon, Spd(knot),
  Course/T, yy/mm/dd, Mag Vari, Mode, Nav. Sta.
- **Two GNGSA panels side by side**, one per satellite system (a "SystemID"
  field labels them, e.g. "GPS" / "Galileo") — 2D/3D, Mode, SV 1–12 (PRNs
  actually used), PDOP, HDOP, VDOP.
- **A satellite sky-plot** — polar/compass diagram (N/S/E/W, concentric
  elevation rings), each visible satellite as a numbered circle at its
  azimuth/elevation, highlighted (e.g. red) if used in the fix vs. just
  visible.
- **An SNR bar chart** — one vertical bar per satellite (by PRN), height =
  signal-to-noise ratio.
- **Two GPGSV/GAGSV panels**, split per constellation — Msg total, Msg num
  (GSV is multi-sentence per epoch), Visible count, then per-satellite rows:
  SV#, Elevation, Azimuth, SNR, Signal ID.
- **A GNVTG panel** — Course/T, Course/M, Spd(knot), Spd(km/h), Mode.
- **A GNGLL panel** — Lat, Lon, UTC, Status, Mode.
- **A GPZDA panel** — UTC, yyyy/mm/dd, Zone offs.
- **A GPHDG panel** (Mag Dir./Dev./Var.) and a **GNGNS panel** (a combined
  fix sentence) — sparser, less central in the reference layout.
- Bottom bar: protocol mode ("UBX-Binary") + active port.

This is a **much** richer tool than the current few-fields prototype. This
plan does not propose building all of it in one PR — see §6 for phasing.

---

## 3. Question 1 — should the richer parsing be gated on the monitor being open?

**Recommendation: yes, gate essentially everything beyond the existing
GGA/RMC/GSA-fixType pipeline behind `gpsMonitorOpen`, with the raw-line ring
buffer as the one pre-existing exception.**

### Why

A 10 Hz multi-constellation receiver is genuinely chatty. GSV in particular
scales with satellite count: a receiver tracking, say, 12 GPS + 10 Galileo +
8 GLONASS satellites emits `ceil(12/4) + ceil(10/4) + ceil(8/4)` = `3 + 3 + 2`
= 8 GSV sentences **per epoch**, each needing to be parsed and folded into a
per-constellation satellite list — at 10 Hz that's 80 GSV sentences/second,
continuously, for as long as the app is open, whether or not the monitor
panel is ever looked at. That is real, mostly-wasted CPU work on a field
laptop, for a diagnostic view that's closed 99% of the time in normal use.

Concretely: parsing cost is **not evenly distributed** across the new
sentence types worth calling out explicitly, because it changes how much
this decision actually saves:

| Sentence | Frequency per epoch | Cost driver |
|---|---|---|
| GSV | scales with visible satellite count × constellation count | the expensive one — reassembly across N sentences, up to dozens of satellite records/epoch |
| Full GSA (PRN list + PDOP/VDOP) | 1 per constellation (typically 1–4/epoch) | cheap — same sentence the core pipeline already touches for `fixType`, just a few more comma-fields |
| VTG, GLL, ZDA, HDG, GNS | ≤1 each per epoch (if emitted at all) | cheap — one sentence, fixed field count |

So, strictly by CPU cost, only GSV *needs* gating — the rest are already
near-free even run unconditionally. Recommend gating **all of them uniformly
anyway**, for a simpler mental model: *"the core GGA/RMC/GSA-fixType
pipeline into `nmeaFix.ts`/the observer is always on; literally everything
else the rich monitor wants is gated behind `gpsMonitorOpen`."* One boolean,
one rule, nothing to remember about which sentence types are the exception.
(Documented alternative, in case a future implementer prefers it: relax the
gate for the cheap ones — always parse full‑GSA/VTG/GLL/ZDA/HDG/GNS, gate
only GSV. Either is defensible; uniform gating is the simpler default.)

### Mechanism

`connection.ts` already has a precedent for "cheap module-level state kept
in sync with a store" (`connectionGeneration`, `lastPort`, etc. are all
plain module variables, not store reads). Follow the same pattern rather
than calling `get(gpsMonitorOpen)` per line (that does a subscribe/read/
unsubscribe every call — wasteful in a per-line hot path):

```ts
import { gpsMonitorOpen } from '../stores/layout';

let monitorActive = false;
gpsMonitorOpen.subscribe((v) => { monitorActive = v; });
```

Then in `applyLine()`, after the existing unchanged core parse/reduce block:

```ts
function applyLine(rawLine: string): void {
  // unchanged: recentLines append, core parseNmeaSentence, nmeaFix reduce,
  // GGA rate tracking, clock offset, throttled flush — all always-on.

  if (monitorActive) {
    const rich = parseRichNmeaSentence(rawLine);   // new, separate parser (§4)
    if (rich) {
      // fold into a new, separate store — see §7 — never touches
      // gpsConnection or setObserver.
    }
  }
}
```

### The tradeoff, made explicit

When the monitor opens, the gated state has no history — it starts empty.
Concretely, how long is "empty" for each new panel:

- **Full GSA / VTG / GLL / ZDA / HDG / GNS**: each is one sentence, so the
  first arrival after opening populates that panel. Worst case ≈
  `1 / fixRateHz` seconds — under a second at 1 Hz, ~100 ms at 10 Hz.
- **GSV / the satellite sky-plot / SNR bars**: a full per-constellation
  satellite list needs the *whole* GSV run for that constellation to arrive
  (all of it is normally transmitted together within one epoch's sentence
  burst, not spread across multiple epochs) — so this is the same
  worst-case bound, ≈ one epoch, not "however long GSV takes to reassemble"
  in absolute terms.

That's a genuinely small, one-epoch flash of emptiness on open, for a
diagnostic tool. **This is acceptable** — recommend not building any
"remember the last rich state across a close/reopen" grace period for phase
1; flagged as an open question in §9 in case the user disagrees once they
see it in practice (toggling the monitor open/closed a lot would mean
re-seeing that brief empty flash each time).

**Keep `recentLines` (the raw-line ring buffer) exactly as it is today** —
always-on, ungated. It's cheap string storage with no NMEA-specific parsing
cost, and it's already proven useful for diagnosing a wrong baud-rate guess
*before* a connection is even fully understood — gating it would remove the
one piece of the monitor that's useful precisely because it has no
dependency on parsing succeeding at all.

---

## 4. Question 2 — multi-constellation / talker-ID handling

`nmea.ts`'s core parser ignores the talker ID entirely, on purpose: the
observer-driving pipeline wants one merged "the fix" regardless of which
constellations contributed to it. **That must not change** — it's a
correct simplification for a single-observer-position safety path, not an
oversight.

The reference tool, in contrast, splits its GSA/GSV panels **per system**
("GPS" / "Galileo" as separate boxes). This needs the rich parser to
actually track talker ID — but there's a real-world subtlety worth planning
around up front, not discovering mid-implementation:

### GSV is talker-ID-clean; GSA often isn't

- **GSV**: by convention, each constellation emits its *own* GSV run under
  its *own* talker ID — `$GPGSV,...` for GPS satellites, `$GLGSV,...` for
  GLONASS, `$GAGSV,...` for Galileo, `$GBGSV,...`/`$BDGSV,...` for BeiDou,
  etc. Talker ID is a reliable, sufficient key to split GSV panels by
  system.
- **GSA**: many modern multi-constellation receivers emit **multiple GSA
  sentences per epoch, all under the shared `GN` talker** (one GSA per
  constellation, but the talker ID itself doesn't distinguish which). NMEA
  4.10 added an optional **trailing "System ID" field** to GSA specifically
  to disambiguate this case (after PDOP/HDOP/VDOP, before the checksum).
  Older/simpler receivers instead emit per-constellation talker IDs
  (`GPGSA`, `GLGSA`, ...) and never populate System ID at all.

Recommendation: the rich parser should key GSA disambiguation on, in order
of preference:

1. The trailing System ID field, when present (NMEA 4.10+ receivers).
2. Fall back to talker ID, when the receiver uses per-constellation talkers
   instead of shared `GN`.
3. **Not implemented in phase 1**: PRN-numbering-range inference (each
   GNSS system has a reserved PRN offset in NMEA's unified satellite
   numbering — GPS 1–32, SBAS 33–64, GLONASS 65–96, Galileo 301–336,
   BeiDou 201–237, QZSS 193–197, roughly) as a last-resort disambiguator
   for a receiver that shares both talker ID *and* omits System ID. Flag
   this explicitly as a known gap rather than silently mis-splitting a
   panel — worth a "Mixed/unknown system" bucket in the UI rather than
   guessing wrong.

This is new code, entirely inside a new module (§7) — `nmea.ts` gains no
new exports and no new talker-ID handling of its own. The core pipeline's
"ignore talker ID" behavior and its own explanatory comment stay exactly as
written.

---

## 5. Question 3 — GSV's multi-sentence-per-epoch reassembly

### The format

One GSV sentence carries: total message count for this system this epoch,
this message's own number (1-indexed), total satellites in view, then up to
4 repeated `(PRN, elevation, azimuth, SNR)` groups (the last message in a
run may have fewer than 4, zero-padded), and — NMEA 4.10+ only — a trailing
Signal ID field (for receivers that report multiple signals per satellite,
e.g. GPS L1 vs L5, as *separate* GSV runs sharing the same talker ID).

### Assembly key

Because dual-frequency receivers can emit more than one GSV run per
constellation per epoch (one per signal ID), the reassembly key should be
**`(talkerId, signalId)`**, not talker ID alone — falling back to just
`talkerId` when Signal ID is absent (pre-4.10 receivers, effectively
`signalId: null` treated as its own bucket).

### Sketch (pseudo-code/types — not implementation)

```ts
// nmeaSatellites.ts (new, sibling to nmeaFix.ts)

export interface SatelliteInView {
  prn: number;
  elevationDeg: number | null;
  azimuthDeg: number | null;
  snrDb: number | null;      // null = tracked but not yet acquiring signal
  usedInFix: boolean;        // cross-referenced from a full-GSA PRN list, see below
}

export interface ConstellationSatellites {
  talkerId: string;          // 'GP' | 'GL' | 'GA' | 'GB' | ...
  systemId: string | null;   // from GSA's trailing field, when known
  signalId: string | null;
  satellites: SatelliteInView[];
  pdop: number | null;
  vdop: number | null;
  hdop: number | null;
  fixType: number | null;    // this constellation's own GSA Mode-2, NOT nmeaFix.ts's global one
}

// Internal, in-progress reassembly buffer, keyed by `${talkerId}:${signalId ?? ''}`
interface GsvAssembly {
  totalMsgs: number;
  slots: (SatelliteInView[] | undefined)[];  // indexed 1..totalMsgs, undefined = not yet seen
}
```

### Gap / out-of-order handling — recommend lenient, not strict

Real-world receivers occasionally drop or reorder a line (same class of
"torn line" concern `nmea.ts`'s own checksum-validation comment already
calls out for the core pipeline). Recommendation:

- Index the working buffer by `msgNum` (1..`totalMsgs`), not by arrival
  order — a message arriving out of sequence still lands in the right slot.
- When a **new** `msgNum === 1` arrives for a key that already has an
  in-progress (incomplete) buffer, **discard** the incomplete buffer and
  start fresh — a live GSV stream refreshes every epoch anyway, so holding
  onto a stale partial set from a prior, now-abandoned epoch is actively
  misleading, not "better than nothing."
- **Publish** (fold into the public `ConstellationSatellites` for that key)
  once every slot `1..totalMsgs` is filled. If a message is truly dropped
  and never arrives before the next `msgNum === 1` supersedes it, that
  epoch's list for this constellation just never publishes — the display
  keeps showing the last complete list rather than a partially-overwritten
  wrong one. This mirrors `nmeaFix.ts`'s own "freeze last-known state rather
  than show something invented" philosophy for fix loss.

### `usedInFix` cross-reference

GSV lists every satellite *in view*; full-GSA lists only the PRNs actually
*used* in the current fix. Populating `SatelliteInView.usedInFix` means
joining the two by PRN, per constellation key — done in the same reducer
(or a thin wrapper around it) once both a completed GSV group and the
matching constellation's latest GSA have been seen. Where exactly this
"same reducer or a thin wrapper" line falls is an implementation detail
worth deciding at PR time, not here.

---

## 6. Phasing

Given the explicit "start small" precedent already set for this whole
feature, propose delivering in visibly-useful increments rather than one
large PR:

| Phase | Scope | Why this grouping |
|---|---|---|
| **1** | Gating mechanism (§3) + GSV parsing/reassembly (§5) + satellite sky-plot (SVG) + SNR bar chart + `GpsMonitorPanel.svelte` layout restructuring from single-grid to multi-panel | Single most visually distinctive addition (a sky-plot is immediately "wow, I can see my satellites"), and it's also where the *answer to the user's own question* (the gating mechanism) has to land — no point building it separately from the first thing it actually gates. Layout restructuring has to happen here too, since a sky-plot + bar chart don't fit the current single fields-grid. |
| **2** | Full GSA (PRN list actually used + PDOP/VDOP) + per-constellation GSA panels side by side, cross-referenced into phase 1's sky-plot/bars (fill/highlight used-vs-visible) | Builds directly on phase 1's per-constellation data structures; the "used in fix" highlight is the payoff that makes phase 1's sky-plot match the reference tool's red-highlight behavior. |
| **3** | VTG, GLL, ZDA, HDG, GNS extra panels | Cheap (no reassembly, one sentence each) but lower value — the user's own read of the reference screenshot was that these panels "appeared sparser/less central." Good candidates for a single combined PR since each is a few fields with no shared complexity. |
| **4 (optional/polish)** | Multi-signal-ID (L1/L5 dual-frequency) display nuance; per-constellation staleness/aging (a constellation disabled mid-session should visibly age out rather than freeze forever — same class of fix `GpsMonitorPanel.svelte` already applied to the Hz readout); protocol-mode bottom bar | See caveat below on protocol mode. |

**Protocol-mode caveat**: the reference tool's bottom-bar "UBX-Binary" label
reflects the *receiver's own* configured protocol mode, which isn't
something derivable from parsed NMEA text at all — a receiver already
talking NMEA is, by definition, not in a binary protocol mode. Showing
anything meaningful here would need a receiver-specific proprietary query
(e.g. u-blox UBX `CFG-PRT` polling), a different scope of work entirely.
Recommend dropping this from scope rather than half-implementing it, and
keep the existing "active port" info (already shown via `monitor.ts`'s
`describePort` + the stored `baudRate`) as the equivalent this app already
has.

---

## 7. File & architecture layout

Follow the existing convention exactly: pure parsers/reducers with their
own `*.test.ts`, kept fully separate from `connection.ts`'s untested
`navigator.serial` glue.

### New modules

- **`app/src/serial/nmeaRich.ts`** (new, NOT an extension of `nmea.ts`) —
  parses full‑GSA (PRN list, PDOP/VDOP, optional System ID), GSV, VTG, GLL,
  ZDA, HDG, GNS. Talker-ID-**aware**, unlike the core parser. Recommend
  keeping this **fully independent** of `nmea.ts` — no shared exports, even
  though it means re-implementing a handful of trivial helpers (checksum
  validation, `toFloat`/`toInt`/lat-lon-degree conversion, each 3–10 lines
  in the original). The core parser is the safety/product-critical,
  field-tested path (see the buffer-overrun postmortem in
  `docs/HANDOFF-2026-07-13.md`) — zero shared surface means zero risk of an
  monitor-only change ever touching it, at the cost of a small amount of
  duplication. (Documented alternative: export the currently-private
  helpers from `nmea.ts` and reuse them — harmless in principle, since it
  only adds exports rather than changing behavior, but it does mean the
  "safety-critical" file's surface area grows for a feature that isn't
  safety-critical. Full separation is the stronger recommendation.)
- **`app/src/serial/nmeaSatellites.ts`** (new, sibling to `nmeaFix.ts`) —
  the GSV reassembly reducer + `SatelliteInView`/`ConstellationSatellites`
  types sketched in §5, plus the full-GSA → `usedInFix` cross-reference.
- **A new store**, e.g. `gpsMonitorState` — recommend this live either as a
  second `writable` in `connection.ts` (co-located with `gpsConnection`,
  since it's still written by `applyLine`) or in a new
  `app/src/stores/gpsMonitor.ts` if `connection.ts` starts feeling
  overloaded once phases 2–3 land. Either way: **do not fold this into
  `gpsConnection`'s existing interface.** That interface is already read by
  `TopBar.svelte`/`GpsRibbon.svelte` and drives the observer position —
  mixing in a per-constellation satellite-list blob would bloat a
  product-critical interface with diagnostic-only data that nothing outside
  `GpsMonitorPanel.svelte` should ever need to read. A separate store makes
  "this is diagnostic-only, gated, and safe to redesign later" obvious by
  construction, the same way `gpsMonitorOpen` already got its own boolean
  in `stores/layout.ts` instead of being folded into `fullscreenPanel`.

### `GpsMonitorPanel.svelte` restructuring

- Move from the current single `.fields` grid + raw-stream layout to a CSS
  grid of bordered per-sentence-type panels, each reusing the existing
  `.field`/`.fields` label+value convention for visual consistency rather
  than inventing a new look per panel.
- **Satellite sky-plot**: `app/src/lib/panels/SkyPanel.svelte`'s all-sky
  view already does exactly this kind of polar projection —
  `domePos(altitude, azimuth)` maps alt/az to dome x/y with N at top, E/W
  mirrored for naked-eye chirality (see that file's own comment on why).
  The satellite sky-plot needs the *same* polar math with satellite
  elevation/azimuth in place of altitude/azimuth, compass chirality instead
  of naked-eye-mirrored (a satellite plot is read like a map from above,
  not lain-on-your-back-looking-up — so do **not** copy `SkyPanel`'s E/W
  mirror, just its general polar-projection shape), no Sun/Moon/stars, just
  numbered PRN circles. Worth a judgment call at implementation time:
  extract a tiny shared `polarProjection(angle, radius)` util (now used in
  2 places) vs. just duplicating the ~5-line formula locally (it's short
  enough that a shared abstraction might be premature). Lean toward
  extracting it, since "reused in exactly 2 places with the same shape" is
  usually where a small shared util starts paying for itself, but this
  isn't a strong recommendation either way.
- **SNR bar chart**: straightforward inline SVG, one bar per satellite
  (0–99 dB-Hz per the NMEA spec's nominal range), colored/highlighted by
  `usedInFix` once phase 2 lands.
- Recommend splitting into sibling sub-components once phase 1's sky-plot +
  bar chart land — e.g. a new **`app/src/lib/gps-monitor/`** directory
  (`SatelliteSkyPlot.svelte`, `SnrBarChart.svelte`, later `GsaPanel.svelte`,
  `GsvPanel.svelte`, ...), mirroring how `GpsMonitorPanel.svelte` and
  `GpsRibbon.svelte` already live directly under `lib/` rather than
  `lib/panels/` (that directory is specifically the 4 main
  `fullscreenPanel`/`PanelId` grid panels — the GPS monitor isn't one of
  those, same reasoning `stores/layout.ts`'s own comment already gives for
  why `gpsMonitorOpen` is a separate boolean rather than a `PanelId`).
  `GpsMonitorPanel.svelte` itself becomes the layout/orchestration shell
  once there are enough sub-panels to justify it — not needed for a
  single-file phase 1 if the diff stays small.

---

## 8. Testing strategy

- `nmeaRich.ts` and `nmeaSatellites.ts` get their own `*.test.ts`, following
  `nmea.test.ts`'s existing convention exactly: a `withChecksum()` helper
  for hand-built field combinations, at least one published/well-known
  example per sentence type as an external sanity check, and explicit
  edge-case tests (empty fields, bad checksum, talker-ID variants).
- For `nmeaSatellites.ts` specifically, cover at minimum: a clean 3-message
  GSV reassembly into one completed group; a dropped middle message (never
  publishes, prior complete state stays); a new `msgNum===1` superseding an
  incomplete prior buffer; multi-constellation disambiguation via System ID
  when present and via talker ID when it isn't; and the GSA→GSV
  `usedInFix` cross-reference.
- **Explicit non-regression check, not just new coverage**: whichever PR
  lands phase 1 should confirm the existing `nmea.test.ts` /
  `nmeaFix.test.ts` / `monitor.test.ts` suite is still 100% green and,
  ideally, that `nmea.ts`'s own diff is empty (not just behaviorally
  unchanged — literally untouched), given how explicitly the user flagged
  this path as "working, tested, field-relied-on."
- `connection.ts`'s `monitorActive` gating is, like the rest of that file,
  inherently hard to unit-test without a `navigator.serial` mock — accepted
  per its own "keep it thin, untested surface stays small" philosophy. If
  the gating check ever grows past a straight boolean read (it shouldn't),
  extract that decision into a small pure predicate so it can move into a
  tested module instead.

---

## 9. Open questions worth confirming before/while implementing

These are judgment calls this doc makes a recommendation on, but that are
worth a real "yes, go" from the user before locking in, since they involve
either product feel or something this investigation couldn't verify from
the code alone:

1. **Grace period on close/reopen?** §3 recommends a hard reset (rich state
   goes fully empty every time the monitor closes) for simplicity. If
   toggling the monitor open/closed repeatedly turns out to feel jarring in
   practice (a fresh ~1-epoch blank flash every time), a short in-memory
   retention window (e.g. keep the last-published state for N seconds after
   close, only truly reset after that) is a small, self-contained addition
   layered on top of phase 1 — not a redesign.
2. **Full separation vs. shared helpers between `nmea.ts` and the new rich
   parser (§7).** Recommendation is full separation (zero shared surface).
   Confirm that's worth the small duplication, versus exporting `nmea.ts`'s
   currently-private helpers.
3. **Real-hardware validation of the GSV volume/timing assumptions in §3
   and §5.** These are reasoned from the NMEA spec and the existing
   codebase's own documented assumptions (e.g. `connection.ts`'s
   `SERIAL_BUFFER_SIZE` comment already reasons about "a 10Hz
   multi-constellation receiver's GGA+RMC+GSA+several GSV blocks+VTG+GLL"),
   not measured against a real 10 Hz multi-constellation receiver's actual
   output. `docs/HANDOFF-2026-07-13.md` flagged the exact same caveat for
   the buffer-overrun fix — worth testing phase 1 against real hardware
   early, not assuming the reasoning holds.
4. **PRN-range disambiguation fallback (§4, item 3)** was scoped out of
   phase 1 as a known gap rather than implemented. Confirm that's
   acceptable, or whether a specific receiver in use is known to need it
   (shares both talker ID and lacks System ID).
