<script lang="ts">
  // Ported from design/layout-v3-fullscreen.html's time-slider script.
  // Times as seconds-since-midnight (STUB_CONTACTS -- Zaragoza reference
  // data). Real contact times (from findContactTimes against the live
  // observer) are wired in as a follow-up slice; this is a mechanical
  // structural + interaction port only.
  import { get } from 'svelte/store';
  import { clock, STUB_CONTACTS as T } from '../stores/clock';

  const MARGIN = 30 * 60; // comfortable margin shown before C1 / after C4
  const domainStart = T.c1 - MARGIN;
  const domainEnd = T.c4 + MARGIN;

  // "real": identity (linear, true spacing). "stretch"/"stretchplus": arcsinh,
  // symmetric around max by construction -- near-linear within about ±K
  // seconds of max, compressing increasingly beyond that, so C2/Max/C3 (a
  // couple minutes apart) get comfortable click targets without the
  // C1..C2 / C3..C4 partial phases (each most of an hour) taking over the
  // whole track. stretchplus reuses the exact same curve with a smaller K.
  const K_STRETCH = 60,
    K_STRETCH_PLUS = 20;

  function fmtHM(t: number) {
    const h = Math.floor(t / 3600),
      m = Math.floor((t % 3600) / 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function fmtM(t: number) {
    return String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  }

  const timeScale = $derived.by(() => {
    const level = $clock.curveLevel;
    const k = level === 'stretchplus' ? K_STRETCH_PLUS : K_STRETCH;
    const warp = (t: number) => (level === 'real' ? t : Math.asinh((t - T.max) / k));
    const unwarp = (w: number) => (level === 'real' ? w : T.max + Math.sinh(w) * k);
    const lo = warp(domainStart),
      hi = warp(domainEnd);
    const pct = (t: number) => ((warp(t) - lo) / (hi - lo)) * 100;
    return { level, k, warp, unwarp, pct };
  });

  const hourBefore = Math.floor(T.max / 3600) * 3600;
  const hourAfter = hourBefore + 3600;
  const tickFirst = Math.ceil(domainStart / 600) * 600;

  const mainTicks = $derived.by(() => {
    const ts = timeScale;
    const marks: { key: string; isHour: boolean; p: number }[] = [];
    for (let t = tickFirst; t <= domainEnd; t += 600) {
      marks.push({ key: 'tick' + t, isHour: t % 3600 === 0, p: ts.pct(t) });
    }
    return marks;
  });

  const mainLabels = $derived.by(() => {
    const ts = timeScale;
    const labels: { key: string; text: string; minor: boolean; p: number }[] = [];
    for (let t = tickFirst; t <= domainEnd; t += 600) {
      const isHour = t % 3600 === 0;
      const showLabel = isHour || ts.level === 'real' || (t >= hourBefore && t <= hourAfter);
      if (showLabel) labels.push({ key: 'lab' + t, text: fmtHM(t), minor: !isHour, p: ts.pct(t) });
    }
    return labels;
  });

  // Stretch view only: 1-min ticks+labels within the two 10-min blocks
  // immediately surrounding max.
  const minuteTicks = $derived.by(() => {
    const ts = timeScale;
    if (ts.level === 'real') return [];
    const maxRound10 = Math.round(T.max / 600) * 600;
    const winStart = Math.max(domainStart, maxRound10 - 600);
    const winEnd = Math.min(domainEnd, maxRound10 + 600);
    const marks: { key: string; t: number; p: number }[] = [];
    for (let t = winStart; t <= winEnd; t += 60) {
      if (t % 600 === 0) continue;
      marks.push({ key: 'mtick' + t, t, p: ts.pct(t) });
    }
    return marks;
  });
  const minuteLabels = $derived(minuteTicks.map((m) => ({ ...m, text: fmtM(m.t) })));

  // The curve is most expanded right at max and compresses further out, so
  // even inside this ±10min window the outermost 1-min ticks can end up
  // pixel-close to the neighboring 10-min mark's (wider) label. Drop just
  // the TEXT for any 1-min label that collides with an already-placed
  // hour/10-min label -- its tick mark stays, so the granularity is still
  // visible, just not a colliding, illegible label on top of it.
  let mainLabelEls: Record<string, HTMLDivElement> = $state({});
  let minuteLabelEls: Record<string, HTMLDivElement> = $state({});
  $effect(() => {
    const mains = mainLabels;
    const minutes = minuteLabels;
    for (const m of minutes) {
      const el = minuteLabelEls[m.key];
      if (el) el.style.display = '';
    }
    const mainRects = mains
      .map((it) => mainLabelEls[it.key]?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r);
    for (const m of minutes) {
      const el = minuteLabelEls[m.key];
      if (!el) continue;
      const mr = el.getBoundingClientRect();
      const collides = mainRects.some((ar) => mr.left < ar.right && ar.left < mr.right);
      if (collides) el.style.display = 'none';
    }
  });

  // C1..C4/Max labels: all on a single row. C1/C4 always render at their
  // true position. C2/Max/C3 can sit only seconds apart on the linear
  // curve, so instead of stacking them, Max stays anchored at its true
  // position and C2/C3 are each pushed away from it by the SAME distance
  // (symmetric), using each label's REAL measured width to find the
  // minimum distance that clears the overlap -- never less than their
  // natural/true spacing, so the stretch curve (already spread out) is
  // untouched.
  const TICK_DEFS = [
    { key: 'c1', lab: 'C1' },
    { key: 'c2', lab: 'C2' },
    { key: 'max', lab: 'Max' },
    { key: 'c3', lab: 'C3' },
    { key: 'c4', lab: 'C4' },
  ] as const;
  const clineItems = $derived(TICK_DEFS.map(({ key, lab }) => ({ key, lab, p: timeScale.pct(T[key]) })));

  let slidertrackEl: HTMLDivElement;
  let clabelEls: Record<string, HTMLDivElement> = $state({});
  $effect(() => {
    const items = clineItems;
    const trackEl = slidertrackEl;
    if (!trackEl) return;
    const trackW = trackEl.getBoundingClientRect().width;
    const pOf = (key: string) => items.find((i) => i.key === key)!.p;
    const pxOf = (key: string) => (pOf(key) / 100) * trackW;
    const widthOf = (key: string) => clabelEls[key]?.getBoundingClientRect().width ?? 0;
    const PAD = 6;

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

    if (clabelEls.c1) clabelEls.c1.style.left = pOf('c1') + '%';
    if (clabelEls.c2) clabelEls.c2.style.left = ((mx - D) / trackW) * 100 + '%';
    if (clabelEls.max) clabelEls.max.style.left = (mx / trackW) * 100 + '%';
    if (clabelEls.c3) clabelEls.c3.style.left = ((mx + D) / trackW) * 100 + '%';
    if (clabelEls.c4) clabelEls.c4.style.left = pOf('c4') + '%';
  });

  const totLeft = $derived(timeScale.pct(T.c2));
  const totWidth = $derived(timeScale.pct(T.c3) - totLeft);
  const cursorPct = $derived(timeScale.pct($clock.simTimeSec));

  function setCurve(level: 'real' | 'stretch' | 'stretchplus') {
    clock.update((c) => ({ ...c, curveLevel: level }));
  }

  // Drawn identically in Live and Sim -- the track only RESPONDS to
  // pointer input in Sim.
  function trackPointerToTime(clientX: number): number {
    const r = slidertrackEl.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const ts = timeScale;
    const lo = ts.warp(domainStart),
      hi = ts.warp(domainEnd);
    return ts.unwarp(lo + frac * (hi - lo));
  }
  function onTrackPointerDown(e: PointerEvent) {
    if (get(clock).mode !== 'sim') return;
    e.preventDefault();
    pauseClock();
    slidertrackEl.setPointerCapture(e.pointerId);
    clock.update((c) => ({ ...c, simTimeSec: trackPointerToTime(e.clientX) }));
    function move(e: PointerEvent) {
      clock.update((c) => ({ ...c, simTimeSec: trackPointerToTime(e.clientX) }));
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
  function clockTick(now: number) {
    let stillPlaying = false;
    clock.update((c) => {
      if (!c.playing) return c;
      const dt = (now - (lastTickWallClock ?? now)) / 1000;
      lastTickWallClock = now;
      let simTimeSec = c.simTimeSec + dt;
      let playing: boolean = c.playing;
      if (simTimeSec >= domainEnd) {
        simTimeSec = domainEnd;
        playing = false;
      }
      stillPlaying = playing;
      return { ...c, simTimeSec, playing };
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
      // Fresh entry into sim always starts here, running -- resuming after
      // a pause/drag continues from wherever it was left instead.
      clock.update((c) => ({ ...c, mode: 'sim', simTimeSec: T.c2 - 90 }));
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
    aria-valuemin={domainStart}
    aria-valuemax={domainEnd}
    aria-valuenow={$clock.simTimeSec}
    tabindex={$clock.mode === 'sim' ? 0 : -1}
    bind:this={slidertrackEl}
    style:cursor={$clock.mode === 'sim' ? 'pointer' : 'default'}
    onpointerdown={onTrackPointerDown}
  >
    <div class="hourlabels">
      {#each mainLabels as lab (lab.key)}
        <div class="hour-lab" class:min10={lab.minor} style:left={lab.p + '%'} bind:this={mainLabelEls[lab.key]}>
          {lab.text}
        </div>
      {/each}
      {#each minuteLabels as lab (lab.key)}
        <div class="hour-lab min1" style:left={lab.p + '%'} bind:this={minuteLabelEls[lab.key]}>
          {lab.text}
        </div>
      {/each}
    </div>
    <div class="axisline"></div>
    <div class="ticks">
      {#each mainTicks as t (t.key)}
        <div class="tick" class:hour={t.isHour} style:left={t.p + '%'}></div>
      {/each}
      {#each minuteTicks as t (t.key)}
        <div class="tick min1" style:left={t.p + '%'}></div>
      {/each}
    </div>
    <div class="totband" style:left={totLeft + '%'} style:width={totWidth + '%'}></div>
    <div class="clines">
      {#each clineItems as it (it.key)}
        <div class="cline" style:left={it.p + '%'}></div>
      {/each}
    </div>
    <div class="clabels">
      {#each clineItems as it (it.key)}
        <div class="clabel" bind:this={clabelEls[it.key]}>{it.lab}</div>
      {/each}
    </div>
    <div class="cursor" style:left={cursorPct + '%'}></div>
  </div>
  <div class="curveswitch">
    <button class:on={$clock.curveLevel === 'real'} onclick={() => setCurve('real')}>Real</button>
    <button class:on={$clock.curveLevel === 'stretch'} onclick={() => setCurve('stretch')}>Stretch</button>
    <button class:on={$clock.curveLevel === 'stretchplus'} onclick={() => setCurve('stretchplus')}
      >Stretch+</button
    >
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
  .hour-lab.min10 {
    font-size: 9px;
    font-weight: 400;
    color: var(--muted);
  }
  .hour-lab.min1 {
    font-size: 8px;
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
  .tick.hour {
    top: 28px;
    height: 20px;
    background: var(--ink);
  }
  .tick.min1 {
    top: 35px;
    height: 6px;
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
