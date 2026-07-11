<script lang="ts">
  // All-sky (dome) is real now (PLAN.md §7): Sun/Moon/stars via
  // stores/skyView.ts (astronomy-engine + the bundled stars.json
  // catalog) for the live observer + clock. Wide view is still the
  // mock's stub -- it isn't alt-az-based at all yet (fixed pixel
  // offsets, not real geometry), a separate follow-up since it needs
  // its own sun-centered projection design, not just plugging in real
  // numbers to the existing formula. Flat/monochrome throughout, same
  // treatment as the countdown schematic (no gradients, no
  // photorealism) -- stars sized by real magnitude, not tinted.
  import { skyView } from '../../stores/skyView';

  let tab: 'wide' | 'allsky' = $state('wide');

  const STARS_WIDE: [number, number][] = [
    [30, 20], [70, 15], [200, 30], [210, 120], [40, 130], [160, 25], [95, 140], [15, 90],
  ];

  const wideCx = 120,
    wideCy = 80,
    wideHorizonY = 108;

  const allCx = 100,
    allCy = 100,
    allR = 88;

  // 90deg alt (zenith) -> center; 0deg (horizon) -> dome edge. Azimuth
  // convention matches astronomy-engine's (clockwise from north), which
  // is also how the cardinal-point labels below are placed.
  function domePos(altitude: number, azimuth: number): [number, number] {
    const azRad = (azimuth * Math.PI) / 180;
    const objR = allR * (1 - altitude / 90);
    return [allCx + objR * Math.sin(azRad), allCy - objR * Math.cos(azRad)];
  }
  function starRadius(mag: number): number {
    return Math.max(0.4, 1.8 - mag * 0.5);
  }

  const allSun = $derived($skyView.sun);
  const allMoon = $derived($skyView.moon);
  const allSunXY = $derived(domePos(allSun.altitude, allSun.azimuth));
  const allMoonXY = $derived(domePos(allMoon.altitude, allMoon.azimuth));
  const allStars = $derived(
    $skyView.stars
      .filter((s) => s.altitude > 0)
      .map((s) => ({ ...s, xy: domePos(s.altitude, s.azimuth), r: starRadius(s.mag) })),
  );
</script>

<div class="skywrap">
  <div class="tabs">
    <button class:on={tab === 'wide'} onclick={() => (tab = 'wide')}>Wide</button>
    <button class:on={tab === 'allsky'} onclick={() => (tab = 'allsky')}>All-sky</button>
  </div>
  <div class="skyzone">
    <svg
      viewBox="0 0 240 160"
      preserveAspectRatio="xMidYMid meet"
      style:display={tab === 'wide' ? 'block' : 'none'}
    >
      {#each STARS_WIDE as [x, y] (x + ',' + y)}
        <circle class="skystar" cx={x} cy={y} r="1" />
      {/each}
      <line class="settrack" x1={wideCx} y1={wideCy} x2={wideCx - 26} y2={wideHorizonY} />
      <circle class="moondisk" cx={wideCx + 3} cy={wideCy - 3} r="15" />
      <circle class="sunring" cx={wideCx} cy={wideCy} r="14" />
      <line class="horizon" x1="0" y1={wideHorizonY} x2="240" y2={wideHorizonY} />
    </svg>
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      style:display={tab === 'allsky' ? 'block' : 'none'}
    >
      <circle class="domecircle" cx={allCx} cy={allCy} r={allR} />
      {#each allStars as star (star.proper ?? star.xy.join(','))}
        <circle class="skystar" cx={star.xy[0]} cy={star.xy[1]} r={star.r} />
      {/each}
      {#if allMoon.altitude > 0}
        <circle class="moondisk" cx={allMoonXY[0]} cy={allMoonXY[1]} r="5.5" />
      {/if}
      {#if allSun.altitude > 0}
        <circle class="sunring" cx={allSunXY[0]} cy={allSunXY[1]} r="5" />
      {/if}
      <text class="cardinal" x={allCx} y={allCy - allR - 8}>N</text>
      <text class="cardinal" x={allCx + allR + 8} y={allCy}>E</text>
      <text class="cardinal" x={allCx} y={allCy + allR + 8}>S</text>
      <text class="cardinal" x={allCx - allR - 8} y={allCy}>W</text>
    </svg>
    {#if tab === 'wide'}
      <div class="fovbox"></div>
    {/if}
  </div>
</div>

<style>
  .skywrap {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tabs {
    flex: 0 0 32px;
    display: flex;
    gap: 2px;
    padding: 8px 14px 0;
  }
  .tabs button {
    background: none;
    border: none;
    font-size: 13px;
    color: var(--muted);
    padding: 4px 8px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tabs button.on {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .skyzone {
    flex: 1;
    background: var(--zone);
    margin: 0 14px 14px;
    border-radius: 6px;
    position: relative;
    overflow: hidden;
  }
  .skyzone svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .horizon {
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  .settrack {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    fill: none;
  }
  .sunring {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  .moondisk {
    fill: var(--ink);
  }
  .skystar {
    fill: var(--muted);
  }
  .domecircle {
    fill: none;
    stroke: var(--line);
    stroke-width: 1;
  }
  .cardinal {
    fill: var(--muted);
    font-size: 10px;
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: middle;
  }
  .fovbox {
    position: absolute;
    inset: 30% 20%;
    border: 1px dashed var(--muted);
    border-radius: 2px;
    pointer-events: none;
  }
</style>
