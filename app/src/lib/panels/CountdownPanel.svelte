<script lang="ts">
  // Countdown display logic against real contact times (PLAN.md §4/§9).
  // Normally ONE line, the next upcoming event. Two lines only between
  // C2 and Max -- once Max has passed, C3 is itself the next contact, so
  // it goes back to a single line ("C3-ttt") like everywhere else.
  //
  // Every event is only ever shown if it's actually observable -- this
  // event is sunset-limited for Spain (PLAN.md §1), and the Besselian
  // shadow-cone geometry has no concept of the horizon, so ANY of
  // C2/Max/C3/C4 can fall after the sun has already set here (not just
  // C4 -- sunset can even land between C1 and C2, e.g. skipping the
  // countdown straight to Sunset without ever mentioning C2). Rather
  // than special-casing "C4 might not be observable" like the previous
  // version did, this picks the next observable event out of all of
  // them uniformly. Once none are left, Sunset itself becomes the
  // countdown target (the real end of visibility); once that's passed
  // too, there's nothing left to count down to.
  import { localCircumstances } from '../../stores/localCircumstances';
  import { effectiveTime } from '../../stores/clock';
  import { skyView } from '../../stores/skyView';
  import { formatCountdown } from '../format';

  const phase = $derived.by(():
    | { mode: 'single'; key: 'c1' | 'c2' | 'max' | 'c3' | 'c4' | 'sunset' }
    | { mode: 'dual' }
    | { mode: 'none' } => {
    const lc = $localCircumstances;
    const nowMs = $effectiveTime.getTime();
    const sunsetMs = lc.sunset ? lc.sunset.getTime() : null;
    const observable = (d: Date | null) => d !== null && (sunsetMs === null || d.getTime() <= sunsetMs);

    // Dual mode only when C2/Max/C3 are ALL observable -- sunset is one
    // cutoff, so if C2 already isn't, nothing chronologically after it
    // is either.
    if (
      observable(lc.c2) &&
      observable(lc.max) &&
      observable(lc.c3) &&
      nowMs >= lc.c2!.getTime() &&
      nowMs < lc.max.getTime()
    ) {
      return { mode: 'dual' };
    }

    const candidates: { key: 'c1' | 'c2' | 'max' | 'c3' | 'c4'; date: Date | null }[] = [
      { key: 'c1', date: lc.c1 },
      { key: 'c2', date: lc.c2 },
      { key: 'max', date: lc.max },
      { key: 'c3', date: lc.c3 },
      { key: 'c4', date: lc.c4 },
    ];
    const next = candidates
      .filter((c) => observable(c.date) && c.date!.getTime() >= nowMs)
      .sort((a, b) => a.date!.getTime() - b.date!.getTime())[0];
    if (next) return { mode: 'single', key: next.key };

    if (sunsetMs !== null && nowMs < sunsetMs) return { mode: 'single', key: 'sunset' };
    return { mode: 'none' };
  });
  const dual = $derived(phase.mode === 'dual');

  const singleLabels = { c1: 'C1', c2: 'C2', max: 'MAX', c3: 'C3', c4: 'C4', sunset: 'SUNSET' } as const;
  const singleText = $derived.by(() => {
    if (phase.mode !== 'single') return '';
    const date = $localCircumstances[phase.key];
    if (!date) return '';
    return singleLabels[phase.key] + formatCountdown((date.getTime() - $effectiveTime.getTime()) / 1000);
  });
  const maxText = $derived(
    'MAX' + formatCountdown(($localCircumstances.max.getTime() - $effectiveTime.getTime()) / 1000),
  );
  const c3Text = $derived.by(() => {
    const c3 = $localCircumstances.c3;
    return c3 ? 'C3' + formatCountdown((c3.getTime() - $effectiveTime.getTime()) / 1000) : '';
  });

  // Side-by-side vs stacked for the dual line pair was previously a
  // static `@container (min-width: 500px)` breakpoint -- but whether two
  // labels actually FIT side by side depends on their real rendered
  // text width (which varies with content, e.g. "MAX-01:21" vs
  // "MAX-00:41.6") at the current cqw/cqh-scaled font size, not just
  // raw container width. A fixed pixel breakpoint can't know that, so it
  // was switching to "row" before there was actually room, clipping the
  // text. Measured directly instead, same spirit as TimeBar's C-line
  // label collision avoidance. The available width has to come from the
  // outer .countdown box, not .numwrap itself: .numwrap sits in a
  // center-aligned flex column, so it shrinks to fit its own content
  // (stacked-mode width = the widest single line) rather than
  // stretching to the panel's real width -- measuring numwrap's own
  // rect would be circular and could never detect that more room is
  // available.
  //
  // Uses a real ResizeObserver rather than re-measuring on every
  // countdown tick: this panel can sit paused for a long time (Sim mode
  // stopped mid-drag), and dragging the pane splitter narrower while
  // paused must still flip back to stacked immediately -- a tick-driven
  // re-measure would leave it wrongly stuck in "row" (and clipping)
  // until the next text change. Observing the two labels themselves
  // also catches text-width changes for free (digit count can change,
  // e.g. "9.9s" -> "10.0s"), so there's no need to separately depend on
  // maxText/c3Text.
  let maxLabelEl: HTMLDivElement | undefined = $state();
  let c3LabelEl: HTMLDivElement | undefined = $state();
  let countdownEl: HTMLDivElement | undefined = $state();
  let dualRow = $state(false);
  const ROW_GAP_PX = 28;
  const COUNTDOWN_PADDING_PX = 4;
  $effect(() => {
    if (phase.mode !== 'dual' || !maxLabelEl || !c3LabelEl || !countdownEl) return;
    const maxEl = maxLabelEl;
    const c3El = c3LabelEl;
    const cdEl = countdownEl;
    const measure = () => {
      const w1 = maxEl.getBoundingClientRect().width;
      const w2 = c3El.getBoundingClientRect().width;
      const available = cdEl.getBoundingClientRect().width - 2 * COUNTDOWN_PADDING_PX;
      dualRow = w1 + w2 + ROW_GAP_PX <= available;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(maxEl);
    ro.observe(c3El);
    ro.observe(cdEl);
    return () => ro.disconnect();
  });

  // Real Sun/Moon schematic (PLAN.md §9/§10 -- "flat monochrome", still
  // no gradients/photorealism, just no longer a fixed placeholder).
  // Sun radius is pinned to SUN_R_PX -- a fixed, deliberately large
  // size (matching the original mock's hand-picked ~44px-in-120 scale)
  // -- and everything else (Moon's radius, and the Sun-Moon offset) is
  // scaled by the same real degrees-per-pixel factor, so relative
  // sizes/positions stay physically correct as the real angular
  // radii/separation (stores/skyView.ts) change.
  //
  // Deliberately UNCLAMPED: the Moon renders at its true scaled
  // position, however far that is from the Sun. An earlier version
  // clamped the offset to fit the Moon's whole disk inside the
  // viewBox, which forced a much bigger viewBox to avoid clipping --
  // shrinking the Sun to a small fraction of the panel to make room.
  // The Moon doesn't need to stay fully visible: outside the C1-C4
  // window (most of the time) it's simply not near the Sun, and the
  // schematic showing "no Moon in view" is the physically honest
  // picture, not a bug to hide. Close to C1/C4 the Moon's disk can
  // partially exceed the viewBox and get clipped by the SVG's own box
  // (`overflow: hidden` below) -- a partial circle/crescent at the
  // frame edge, not a distortion of its position. That box is a
  // separate flex child BELOW .numwrap, so this clipping can never
  // cover the countdown text.
  //
  // This offset comes from astronomy-engine's own real-time ephemeris
  // (stores/skyView.ts), independent of the Besselian/eclipse-calc
  // pipeline that computes the official C2/C3 shown in the countdown
  // text -- the two agree closely (eclipse/astronomyEngineDeltaT.ts
  // makes astronomy-engine use the same ΔT as the Besselian side; see
  // PLAN.md for the small residual that's left).
  const VIEWBOX_HALF = 60;
  const SUN_R_PX = 44;
  // How far past the square viewBox the horizon line/ground fill
  // extend, so they reach the panel's true left/right (and, if ever
  // taller than wide, bottom) edges through preserveAspectRatio
  // letterboxing rather than stopping at the nominal 120-unit square.
  // Generous on purpose -- cheap to render, and this panel is never
  // going to be 10x wider than tall.
  const HORIZON_EXTENT = 1000;
  const schematic = $derived.by(() => {
    const { sun, moon, moonSunSeparationDeg, horizonDepressionDeg } = $skyView;
    const pxPerDeg = SUN_R_PX / sun.angularRadiusDeg;
    const moonRPx = moon.angularRadiusDeg * pxPerDeg;

    // Local tangent-plane offset (accurate enough at the sub-degree
    // separations that matter here): azimuth compressed by cos(altitude).
    const altRad = (sun.altitude * Math.PI) / 180;
    let dAz = moon.azimuth - sun.azimuth;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    const dxDeg = dAz * Math.cos(altRad);
    const dyDeg = moon.altitude - sun.altitude;
    const offsetX = dxDeg * pxPerDeg;
    const offsetY = -dyDeg * pxPerDeg;

    // Horizon line: positioned so the Sun's rendered upper edge (its
    // disk is drawn fixed at the viewBox center, radius SUN_R_PX --
    // "upper edge" is always exactly SUN_R_PX above that center)
    // crosses it at the SAME instant astronomy-engine's own
    // SearchRiseSet (stores/localCircumstances.ts's Sunset) reports.
    // That takes real care: SearchRiseSet's criterion is "the Sun's
    // UNREFRACTED (geometric) center altitude equals -horizonDepressionDeg
    // - angularRadiusDeg" -- using a fixed ~34' refraction CONSTANT
    // (scaled by atmospheric density at the observer's elevation), NOT
    // the altitude-dependent Saemundsson formula 'normal' mode uses for
    // sun.altitude above. Those two refraction models genuinely
    // disagree at these shallow angles (measured: ~37' vs the standard
    // 34' right at this event's sunset, an ~8.5px difference in this
    // schematic's scale) -- reusing the refracted sun.altitude here,
    // as an earlier version did, made the horizon line cross the Sun's
    // edge several seconds off from the real Sunset time. Using
    // altitudeTrueDeg + horizonDepressionDeg instead (both computed in
    // skyView.ts using the exact same constant/formula SearchRiseSet
    // uses) verified to sub-second alignment against the real Sunset
    // instant (a temporary scratch test, deleted after).
    const horizonY = VIEWBOX_HALF + (sun.altitudeTrueDeg + horizonDepressionDeg) * pxPerDeg;

    return {
      moonRPx,
      moonCx: VIEWBOX_HALF + offsetX,
      moonCy: VIEWBOX_HALF + offsetY,
      horizonY,
      separationDeg: moonSunSeparationDeg,
    };
  });
</script>

<div class="countdown" bind:this={countdownEl}>
  <div class="numwrap" class:dual class:row={dual && dualRow}>
    {#if dual}
      <div class="numline" bind:this={maxLabelEl}>{maxText}</div>
      <div class="numline" bind:this={c3LabelEl}>{c3Text}</div>
    {:else if phase.mode === 'none'}
      <div class="numline">Event ended</div>
    {:else}
      <div class="numline">{singleText}</div>
    {/if}
  </div>
  <svg viewBox="0 0 {VIEWBOX_HALF * 2} {VIEWBOX_HALF * 2}">
    <circle cx={VIEWBOX_HALF} cy={VIEWBOX_HALF} r={SUN_R_PX} fill="#f6c445" />
    <circle cx={schematic.moonCx} cy={schematic.moonCy} r={schematic.moonRPx} fill="#000000" />
    <!-- Ground: painted over the Sun/Moon (not behind them) so the
         setting Sun visibly sinks behind it, dimly showing through the
         transparent fill rather than being hard-clipped. Extends far
         past the nominal 0..VIEWBOX_HALF*2 square -- the panel itself
         is wider than the (square) viewBox, so with the default
         xMidYMid preserveAspectRatio the square viewBox is letterboxed
         and doesn't reach the panel's real left/right edges; going way
         past it here means it's the *rendered element's* overflow:hidden
         clip (the true panel bounds) that cuts this off, not the
         viewBox's own coordinate range. -->
    <rect
      class="ground"
      x={-HORIZON_EXTENT}
      y={schematic.horizonY}
      width={HORIZON_EXTENT * 2}
      height={Math.max(0, VIEWBOX_HALF * 2 - schematic.horizonY + HORIZON_EXTENT)}
    />
    <line
      class="horizonline"
      x1={-HORIZON_EXTENT}
      y1={schematic.horizonY}
      x2={HORIZON_EXTENT}
      y2={schematic.horizonY}
    />
  </svg>
</div>

<style>
  /* Sized off native cqw/cqh -- deliberately with NO fixed-pixel ceiling
     anywhere in the formula, unlike the contacts table: a fixed ceiling is
     not physically zoom-invariant, so this panel should fill available
     space unconditionally. The floor (20px/16px) is a plain literal and
     only matters in the already-extreme small-panel case. Requires the
     nearest ancestor (App.svelte's .pane) to set container-type: size. */
  .countdown {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    gap: 4px;
    padding: 4px;
    /* Dark night-sky backdrop, covering the countdown text as well as
       the Sun/Moon graphic -- one shared panel background, not just
       behind the svg. */
    background: #2b4d82;
    border-radius: 6px;
  }
  .numwrap {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    color: #ffffff;
    /* Reserved for the DUAL-stacked worst case regardless of which mode
       is actually showing, so switching between single/dual (or
       stacked/row) never changes this box's height -- that height
       change was what pushed the SVG below it up/down, reading as "the
       moon jumped". */
    min-height: calc(2 * max(16px, min(16cqw, 12cqh)) * 1.2 + 4px);
  }
  .numwrap .numline {
    font-family: 'SF Mono', 'Cascadia Mono', Consolas, monospace;
    font-weight: 500;
    letter-spacing: -0.5px;
    white-space: nowrap;
    font-size: max(20px, min(14cqw, 20cqh));
  }
  .numwrap.dual .numline {
    font-size: max(16px, min(16cqw, 12cqh));
  }
  .numwrap.dual.row {
    flex-direction: row;
    gap: 28px;
  }
  .countdown svg {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    /* Explicit, not relying on the browser default: the Moon is
       unclamped and can render partway (or fully) outside the
       viewBox near/outside C1-C4 -- this box is what gives that a
       clean edge instead of bleeding into surrounding UI. The dark
       sky background now lives on .countdown itself (shared with the
       text), so this box stays transparent and just shows it through. */
    overflow: hidden;
  }
  .ground {
    fill: #05070d;
    fill-opacity: 0.6;
  }
  .horizonline {
    stroke: #dce4f2;
    stroke-width: 1.5;
  }
</style>
