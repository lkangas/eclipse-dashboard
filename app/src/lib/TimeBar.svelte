<script lang="ts">
  // Ported from design/layout-v3-fullscreen.html's time-slider script,
  // now driven by real per-observer contact times (localCircumstances)
  // instead of the mock's hardcoded STUB_CONTACTS. Internally works in
  // epoch SECONDS (not ms); the clock store itself holds ms (standard JS
  // Date convention). The track is always linear -- no more arcsinh warp
  // curve -- with the visible domain itself switched by the Zoom in/
  // Default/Zoom out buttons instead (see ZoomLevel in stores/clock.ts).
  import { get } from 'svelte/store';
  import { clock, effectiveTime } from '../stores/clock';
  import { localCircumstances } from '../stores/localCircumstances';

  const MARGIN_S = 30 * 60; // 'default' zoom: comfortable margin before C1 / after C4
  const ZOOM_IN_MARGIN_S = 3 * 60; // 'in' zoom: margin either side of C2/C3

  // Fixed zoom-out window (UTC), per direct request -- comfortably covers
  // the whole event (partial phase through sunset) with margin either
  // side, as a literal clock range rather than one derived from contact
  // times. Temporary/placeholder ("will be removed later"), so kept as a
  // plain local constant rather than threaded through as configuration.
  const ZOOM_OUT_START_S = Date.UTC(2026, 7, 12, 15, 30, 0) / 1000;
  const ZOOM_OUT_END_S = Date.UTC(2026, 7, 12, 20, 0, 0) / 1000;

  const hmFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const mFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    minute: '2-digit',
    hour12: false,
  });
  function fmtHM(epochSec: number): string {
    return hmFmt.format(new Date(epochSec * 1000));
  }
  function fmtM(epochSec: number): string {
    return mFmt.format(new Date(epochSec * 1000));
  }

  // Event contact times for the live observer, in epoch seconds. C2/C3
  // (totality) can be null outside the umbral path -- C1/C4 (partial)
  // fall back to a ±1h window around Max so the timeline never breaks
  // even for a pathological observer with no partial eclipse either.
  // Sunset (astronomy-engine, stores/localCircumstances.ts) is real and
  // shown on the timeline like any other contact -- this event is
  // sunset-limited for Spain (PLAN.md §1), so it's often the thing that
  // actually ends visibility, not C4.
  const eventSec = $derived.by(() => {
    const lc = $localCircumstances;
    const maxS = lc.max.getTime() / 1000;
    return {
      c1: lc.c1 ? lc.c1.getTime() / 1000 : maxS - 3600,
      c2: lc.c2 ? lc.c2.getTime() / 1000 : null,
      max: maxS,
      c3: lc.c3 ? lc.c3.getTime() / 1000 : null,
      c4: lc.c4 ? lc.c4.getTime() / 1000 : maxS + 3600,
      sunset: lc.sunset ? lc.sunset.getTime() / 1000 : null,
    };
  });
  const hasTotality = $derived(eventSec.c2 !== null && eventSec.c3 !== null);

  // Zoom in: a close-up on totality, C2..C3 with a few minutes' margin
  // (falling back to Max +/- that same margin where there's no totality
  // for this observer, so the track never breaks). Default: the whole
  // event, C1..C4/sunset with a comfortable margin -- the original
  // (pre-zoom-buttons) domain. Zoom out: the fixed placeholder window
  // declared above. Either way the track itself is plain linear.
  const domainStart = $derived.by(() => {
    const z = $clock.zoomLevel;
    if (z === 'in') return (eventSec.c2 ?? eventSec.max) - ZOOM_IN_MARGIN_S;
    if (z === 'out') return ZOOM_OUT_START_S;
    return eventSec.c1 - MARGIN_S;
  });
  const domainEnd = $derived.by(() => {
    const z = $clock.zoomLevel;
    if (z === 'in') return (eventSec.c3 ?? eventSec.max) + ZOOM_IN_MARGIN_S;
    if (z === 'out') return ZOOM_OUT_END_S;
    // Cap at sunset, not C4, when C4 isn't observable (sunset-limited
    // event -- PLAN.md §1) -- otherwise the track would reserve space
    // for a contact that's hidden from clineItems below anyway.
    return (eventSec.sunset !== null ? Math.min(eventSec.c4, eventSec.sunset) : eventSec.c4) + MARGIN_S;
  });

  const timeScale = $derived.by(() => {
    const lo = domainStart,
      hi = domainEnd;
    const span = hi - lo;
    const pct = (t: number) => ((t - lo) / span) * 100;
    return { lo, hi, span, pct };
  });

  // Tick/label granularity adapts to how wide the current domain is,
  // rather than the old dual-scale (10min main + 1min "stretch" overlay)
  // system -- one linear domain now needs only one tick step. Major
  // ticks (bold, full HH:MM label) fall every 5min in the narrow zoom-in
  // domain or every hour in the wide zoom-out one; minor ticks in
  // between get a short minutes-only label.
  const tickStepS = $derived(domainEnd - domainStart <= 40 * 60 ? 60 : 600);
  const majorStepS = $derived(tickStepS === 60 ? 5 * 60 : 3600);
  const tickFirst = $derived(Math.ceil(domainStart / tickStepS) * tickStepS);

  const mainTicks = $derived.by(() => {
    const ts = timeScale;
    const step = tickStepS,
      major = majorStepS;
    const marks: { key: string; isMajor: boolean; p: number }[] = [];
    for (let t = tickFirst; t <= domainEnd; t += step) {
      marks.push({ key: 'tick' + t, isMajor: t % major === 0, p: ts.pct(t) });
    }
    return marks;
  });

  const mainLabels = $derived.by(() => {
    const ts = timeScale;
    const step = tickStepS,
      major = majorStepS;
    const labels: { key: string; text: string; minor: boolean; p: number }[] = [];
    for (let t = tickFirst; t <= domainEnd; t += step) {
      const isMajor = t % major === 0;
      labels.push({ key: 'lab' + t, text: isMajor ? fmtHM(t) : fmtM(t), minor: !isMajor, p: ts.pct(t) });
    }
    return labels;
  });

  // C1..C4/Max labels: all on a single row. C1/C4 always render at their
  // true position. When this observer sees totality, C2/Max/C3 can sit
  // only seconds apart on the linear curve, so instead of stacking them,
  // Max stays anchored at its true position and C2/C3 are each pushed
  // away from it by the SAME distance (symmetric), using each label's
  // REAL measured width to find the minimum distance that clears the
  // overlap -- never less than their natural/true spacing, so the
  // stretch curve (already spread out) is untouched. Outside totality,
  // C2/C3 don't exist and Max just renders at its true position too.
  const TICK_DEFS = [
    { key: 'c1', lab: 'C1' },
    { key: 'c2', lab: 'C2' },
    { key: 'max', lab: 'Max' },
    { key: 'c3', lab: 'C3' },
    { key: 'c4', lab: 'C4' },
    { key: 'sunset', lab: 'Sunset' },
  ] as const;
  const clineItems = $derived.by(() => {
    const ts = timeScale;
    const ev = eventSec;
    return TICK_DEFS.filter(({ key }) => {
      const t = ev[key];
      if (t === null) return false;
      // Non-observable (past sunset) events don't belong on the
      // timeline either -- same reasoning as ContactsPanel.
      if (key !== 'sunset' && ev.sunset !== null && t > ev.sunset) return false;
      // Outside the currently visible domain (e.g. C1 while zoomed in on
      // Max) -- drawing it would just place a label off the track.
      return t >= domainStart && t <= domainEnd;
    }).map(({ key, lab }) => ({
      key,
      lab,
      p: ts.pct(eventSec[key] as number),
    }));
  });

  let slidertrackEl: HTMLDivElement;
  let clabelEls: Record<string, HTMLDivElement> = $state({});
  $effect(() => {
    const items = clineItems;
    const trackEl = slidertrackEl;
    if (!trackEl) return;
    const trackW = trackEl.getBoundingClientRect().width;
    const pOf = (key: string) => items.find((i) => i.key === key)?.p ?? 0;
    const widthOf = (key: string) => clabelEls[key]?.getBoundingClientRect().width ?? 0;

    if (hasTotality) {
      const PAD = 6;
      const pxOf = (key: string) => (pOf(key) / 100) * trackW;
      const mx = pxOf('max'),
        wMax = widthOf('max');
      const c2px = pxOf('c2'),
        wC2 = widthOf('c2');
      const c3px = pxOf('c3'),
        wC3 = widthOf('c3');
      const neededLeft = wMax / 2 + wC2 / 2 + PAD;
      const neededRight = wMax / 2 + wC3 / 2 + PAD;
      const trueLeft = mx - c2px,
        trueRight = c3px - mx;
      const D = Math.max(neededLeft, neededRight, trueLeft, trueRight);
      if (clabelEls.c2) clabelEls.c2.style.left = ((mx - D) / trackW) * 100 + '%';
      if (clabelEls.max) clabelEls.max.style.left = (mx / trackW) * 100 + '%';
      if (clabelEls.c3) clabelEls.c3.style.left = ((mx + D) / trackW) * 100 + '%';
    } else if (clabelEls.max) {
      clabelEls.max.style.left = pOf('max') + '%';
    }
    if (clabelEls.c1) clabelEls.c1.style.left = pOf('c1') + '%';
    if (clabelEls.c4) clabelEls.c4.style.left = pOf('c4') + '%';
    if (clabelEls.sunset) clabelEls.sunset.style.left = pOf('sunset') + '%';
  });

  // Clamped to the visible domain -- C2/C3 are only ever this far outside
  // it (zoomed out to a window narrower than totality) in a pathological
  // case that can't happen with the two fixed windows above, but clamping
  // is cheap insurance against a stray/negative-width band either way.
  const totLeft = $derived(
    hasTotality ? Math.max(0, Math.min(100, timeScale.pct(eventSec.c2 as number))) : 0,
  );
  const totRight = $derived(
    hasTotality ? Math.max(0, Math.min(100, timeScale.pct(eventSec.c3 as number))) : 0,
  );
  const totWidth = $derived(Math.max(0, totRight - totLeft));

  const cursorSec = $derived($effectiveTime.getTime() / 1000);
  const cursorInDomain = $derived(cursorSec >= domainStart && cursorSec <= domainEnd);
  const cursorPct = $derived(timeScale.pct(cursorSec));

  function setZoom(level: 'in' | 'default' | 'out') {
    clock.update((c) => ({ ...c, zoomLevel: level }));
  }

  // Drawn identically in Live and Sim -- the track only RESPONDS to
  // pointer input in Sim.
  function trackPointerToTime(clientX: number): number {
    const r = slidertrackEl.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return domainStart + frac * (domainEnd - domainStart);
  }
  function onTrackPointerDown(e: PointerEvent) {
    if (get(clock).mode !== 'sim') return;
    e.preventDefault();
    pauseClock();
    slidertrackEl.setPointerCapture(e.pointerId);
    clock.update((c) => ({ ...c, simTimeMs: trackPointerToTime(e.clientX) * 1000 }));
    function move(e: PointerEvent) {
      clock.update((c) => ({ ...c, simTimeMs: trackPointerToTime(e.clientX) * 1000 }));
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // --- Sim playback: real-time clock, pause/resume ---
  let lastTickWallClock: number | null = null;
  let rafId: number | null = null;
  function startClock() {
    clock.update((c) => ({ ...c, playing: true }));
    lastTickWallClock = performance.now();
    rafId = requestAnimationFrame(clockTick);
  }
  function pauseClock() {
    clock.update((c) => (c.playing ? { ...c, playing: false } : c));
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }
  function clockTick(nowMs: number) {
    let stillPlaying = false;
    clock.update((c) => {
      if (!c.playing) return c;
      const dtMs = nowMs - (lastTickWallClock ?? nowMs);
      lastTickWallClock = nowMs;
      let simTimeMs = c.simTimeMs + dtMs;
      let playing: boolean = c.playing;
      const endMs = domainEnd * 1000;
      if (simTimeMs >= endMs) {
        simTimeMs = endMs;
        playing = false;
      }
      stillPlaying = playing;
      return { ...c, simTimeMs, playing };
    });
    if (stillPlaying) rafId = requestAnimationFrame(clockTick);
  }
  function togglePlay() {
    if (get(clock).playing) pauseClock();
    else startClock();
  }

  // --- Live / Sim mode ---
  // Sim is deliberately harder to enter than to leave: pressing Sim while
  // Live never switches immediately -- it arms (button becomes "Confirm",
  // amber) and needs a second press within a few seconds, or it quietly
  // reverts. Live always switches back in a single press.
  let confirmPending = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function goLive() {
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmPending = false;
    clock.update((c) => ({ ...c, mode: 'live' }));
    pauseClock();
  }
  // Fresh entry into sim always starts 90s before C2 (or, outside
  // totality, 90s before Max) -- resuming after a pause/drag continues
  // from wherever it was left instead.
  function freshSimStartMs(): number {
    const lc = get(localCircumstances);
    const base = lc.c2 ?? lc.max;
    return base.getTime() - 90_000;
  }
  function onSimClick() {
    if (get(clock).mode === 'sim') return;
    if (!confirmPending) {
      confirmPending = true;
      confirmTimer = setTimeout(() => {
        confirmPending = false;
      }, 3000);
    } else {
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmPending = false;
      clock.update((c) => ({ ...c, mode: 'sim', simTimeMs: freshSimStartMs() }));
      startClock();
    }
  }
</script>

<div class="timebar">
  <div class="modeswitch">
    <button class="live" class:on={$clock.mode === 'live'} onclick={goLive}>Live</button>
    <button
      class="sim"
      class:on={$clock.mode === 'sim'}
      class:confirm={confirmPending}
      onclick={onSimClick}
    >
      {confirmPending ? 'Confirm' : 'Sim'}
    </button>
  </div>
  <button
    class="playbtn"
    title="Play/Pause"
    style:visibility={$clock.mode === 'sim' ? 'visible' : 'hidden'}
    onclick={togglePlay}
  >
    {$clock.playing ? '⏸' : '▶'}
  </button>
  <div
    class="slidertrack"
    role="slider"
    aria-label="Simulated time"
    aria-valuemin={domainStart * 1000}
    aria-valuemax={domainEnd * 1000}
    aria-valuenow={$effectiveTime.getTime()}
    tabindex={$clock.mode === 'sim' ? 0 : -1}
    bind:this={slidertrackEl}
    style:cursor={$clock.mode === 'sim' ? 'pointer' : 'default'}
    onpointerdown={onTrackPointerDown}
  >
    <div class="hourlabels">
      {#each mainLabels as lab (lab.key)}
        <div class="hour-lab" class:minor={lab.minor} style:left={lab.p + '%'}>
          {lab.text}
        </div>
      {/each}
    </div>
    <div class="axisline"></div>
    <div class="ticks">
      {#each mainTicks as t (t.key)}
        <div class="tick" class:major={t.isMajor} style:left={t.p + '%'}></div>
      {/each}
    </div>
    {#if hasTotality}
      <div class="totband" style:left={totLeft + '%'} style:width={totWidth + '%'}></div>
    {/if}
    <div class="clines">
      {#each clineItems as it (it.key)}
        <div class="cline" class:sunset={it.key === 'sunset'} style:left={it.p + '%'}></div>
      {/each}
    </div>
    <div class="clabels">
      {#each clineItems as it (it.key)}
        <div class="clabel" class:sunset={it.key === 'sunset'} bind:this={clabelEls[it.key]}>{it.lab}</div>
      {/each}
    </div>
    <div class="cursor" style:left={cursorPct + '%'} style:opacity={cursorInDomain ? 1 : 0}></div>
  </div>
  <div class="curveswitch">
    <button class:on={$clock.zoomLevel === 'in'} onclick={() => setZoom('in')}>Zoom in</button>
    <button class:on={$clock.zoomLevel === 'default'} onclick={() => setZoom('default')}>Default</button>
    <button class:on={$clock.zoomLevel === 'out'} onclick={() => setZoom('out')}>Zoom out</button>
  </div>
</div>

<style>
  /* Live/Sim is deliberately the most visually forceful control on screen --
     leaving Live during the actual event by accident is the one mistake
     this UI should make hard. Fixed min-width on both mode buttons so
     arming ("Sim" -> "Confirm", a longer, bolder label) never resizes the
     control. */
  .timebar {
    flex: 0 0 84px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 16px;
    border-top: 1px solid var(--line);
    user-select: none;
    -webkit-user-select: none;
  }

  .modeswitch {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .modeswitch button {
    background: none;
    border: none;
    padding: 10px 4px;
    width: 88px;
    font-weight: 500;
    font-size: 14px;
    color: var(--muted);
    cursor: pointer;
  }
  .modeswitch button.live.on {
    background: var(--live-bg);
    color: var(--live-ink);
    font-weight: 700;
  }
  .modeswitch button.live.on::before {
    content: '\25CF ';
  }
  .modeswitch button.sim.on {
    background: var(--ink);
    color: #fff;
  }
  .modeswitch button.sim.confirm {
    background: var(--accent);
    color: #000;
    font-weight: 700;
  }

  .curveswitch {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .curveswitch button {
    background: none;
    border: none;
    padding: 10px 4px;
    width: 74px;
    font-weight: 500;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
  }
  .curveswitch button.on {
    background: var(--ink);
    color: #fff;
  }

  .playbtn {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .playbtn:hover {
    border-color: var(--muted);
  }

  /* Timeline, in three vertically distinct, non-overlapping bands so the
     cursor (confined to the middle band) can never overlap a label:
       0-16px   hour labels (text)
       16-60px  axis + tick marks + C1..C4/Max lines + the cursor
       62-76px  C1..C4/Max text labels, all in a single row */
  .slidertrack {
    flex: 1;
    position: relative;
    height: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .hourlabels {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 16px;
  }
  .hour-lab {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 10px;
    font-weight: 500;
    color: var(--ink);
    white-space: nowrap;
  }
  .hour-lab.minor {
    font-size: 9px;
    font-weight: 400;
    color: var(--muted);
  }

  .axisline {
    position: absolute;
    left: 0;
    right: 0;
    top: 38px;
    height: 1px;
    background: var(--line);
  }
  .ticks {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 100%;
  }
  /* width:2px, not 1px -- these sit at percentage-based (often fractional
     pixel) positions, and a 1px-wide mark at a fractional offset gets
     anti-aliased across two physical pixels at partial opacity each. 2px
     guarantees at least one full solid pixel of coverage regardless of
     position. */
  .tick {
    position: absolute;
    top: 32px;
    width: 2px;
    height: 12px;
    background: var(--ink);
  }
  .tick.major {
    top: 28px;
    height: 20px;
    background: var(--ink);
  }

  .totband {
    position: absolute;
    height: 16px;
    top: 30px;
    background: var(--accent-bg);
    border-radius: 3px;
  }
  .clines {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 100%;
  }
  .cline {
    position: absolute;
    top: 22px;
    width: 2px;
    height: 32px;
    background: var(--cline);
  }
  /* Sunset is a horizon event, not a shadow-geometry contact -- given
     its own (dashed, accent-colored) treatment so it doesn't read as
     just another C1..C4 contact. */
  .cline.sunset {
    background: none;
    border-left: 2px dashed var(--accent);
    width: 0;
  }

  .clabels {
    position: absolute;
    left: 0;
    right: 0;
    top: 62px;
    height: 14px;
  }
  .clabel {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 11px;
    font-weight: 500;
    color: var(--ink);
    white-space: nowrap;
  }
  .clabel.sunset {
    color: var(--accent-ink);
  }

  /* Custom-drawn (not a native range input) so it renders identically in
     Live and Sim -- only whether the track responds to pointer input
     differs. */
  .cursor {
    position: absolute;
    top: 20px;
    width: 2px;
    height: 36px;
    background: #c22;
    z-index: 3;
    pointer-events: none;
  }
</style>
