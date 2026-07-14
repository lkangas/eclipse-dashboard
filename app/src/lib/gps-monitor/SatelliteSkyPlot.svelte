<script lang="ts">
  // Compass sky-plot for the rich GPS monitor (GPS-MONITOR-PLAN.md Phase
  // 1) -- one dot per tracked satellite, positioned by its own
  // elevation/azimuth (from GSV, via nmeaSatellites.ts's reassembly),
  // colored by constellation. No props -- subscribes to gpsSatellites
  // directly, matching this codebase's convention of components reading
  // stores themselves rather than taking them as props (see
  // GpsMonitorPanel.svelte's own direct gpsConnection import).
  //
  // Chirality note: this is a COMPASS/map view (looking down from above),
  // the OPPOSITE of SkyPanel.svelte's all-sky dome, which mirrors E/W on
  // purpose for a naked-eye "lying on your back looking up" view (see
  // that file's own domePos() comment). Here, azimuth increasing
  // clockwise from north genuinely moves rightward on screen -- E must
  // render on the RIGHT. Do NOT "fix" this to match SkyPanel's mirror;
  // the two views have different, both-correct chirality for what they
  // each represent. That's why this file has its own tiny projection
  // function (skyPos below) instead of importing/reusing SkyPanel's.
  //
  // Used-vs-visible encoding (GPS-MONITOR-PLAN.md §6 phase 2): the
  // per-constellation dot COLOR stays exactly as phase 1 built it (still
  // useful -- the dedicated GSA/GSV panels split by system, but this
  // shared plot benefits from showing both signals at once). Layered on
  // top: a satellite actually used in the current fix (cross-referenced
  // from the matching GSA's PRN list, see findMatchingGsa/withUsedInFix)
  // renders as a SOLID dot in its constellation color; a satellite that's
  // merely visible (tracked by GSV but not in that GSA's used-PRN list)
  // renders as an OUTLINE-ONLY circle -- stroke in the same constellation
  // color, no fill -- so it still reads as "which system" at a glance,
  // just visually lighter for "not contributing to the fix." When no
  // matching GSA exists at all for a constellation (the documented
  // shared-GN-talker/no-System-ID gap -- see findMatchingGsa's own
  // comment in nmeaSatellites.ts), every satellite in that group is
  // treated as not-used (outline) rather than guessed -- same safe-default
  // reasoning already established there, achieved for free here by simply
  // passing an empty usedPrns list through the same withUsedInFix() join
  // used for the found case, not a separate code path.
  import { gpsSatellites } from '../../stores/gpsSatellites';
  import { describeConstellation } from '../../serial/monitor';
  import { findMatchingGsa, withUsedInFix } from '../../serial/nmeaSatellites';

  const CX = 100;
  const CY = 100;
  const OUTER_R = 78;
  const RING_ELEVATIONS = [60, 30, 0];
  const SAT_DOT_R = 2.2;

  // Elevation 90 (zenith) -> center; elevation 0 (horizon) -> the outer
  // ring radius. See the file-level comment above for why azimuth is NOT
  // mirrored here the way SkyPanel's domePos() mirrors it.
  function skyPos(elevationDeg: number, azimuthDeg: number): [number, number] {
    const azRad = (azimuthDeg * Math.PI) / 180;
    const r = OUTER_R * (1 - elevationDeg / 90);
    return [CX + r * Math.sin(azRad), CY - r * Math.cos(azRad)];
  }

  function ringRadius(elevationDeg: number): number {
    return OUTER_R * (1 - elevationDeg / 90);
  }

  // Fixed per-system palette (direct request). Fallback var(--accent)
  // covers both 'Multi-GNSS' (a shared GN talker with no per-system
  // split, see nmeaSatellites.ts/GSA's own System-ID subtlety in
  // GPS-MONITOR-PLAN.md §4) and any talker ID describeConstellation()
  // doesn't recognize at all.
  const CONSTELLATION_COLORS: Record<string, string> = {
    GPS: '#4a90d9',
    GLONASS: '#5cb85c',
    Galileo: '#f0ad4e',
    BeiDou: '#9b59b6',
    QZSS: '#e67e22',
    NavIC: '#16a085',
  };
  function constellationColor(systemName: string): string {
    return CONSTELLATION_COLORS[systemName] ?? 'var(--accent)';
  }

  interface PlottedSatellite {
    id: string;
    prn: number;
    x: number;
    y: number;
    color: string;
    usedInFix: boolean;
  }

  interface LegendEntry {
    name: string;
    color: string;
  }

  const groups = $derived(Object.values($gpsSatellites.constellations));
  const noData = $derived(groups.length === 0);

  // Only satellites with a full position (both elevation and azimuth
  // known) get a dot -- anything else has no sensible place to draw.
  const plotted: PlottedSatellite[] = $derived.by(() => {
    const list: PlottedSatellite[] = [];
    for (const group of groups) {
      const color = constellationColor(describeConstellation(group.talkerId));
      // findMatchingGsa returns null for the documented "shared talker,
      // no System ID" gap (see its own comment in nmeaSatellites.ts) --
      // `?? []` then makes withUsedInFix mark every satellite in this
      // group as not-used, the safe default, without a separate branch.
      const gsaInfo = findMatchingGsa($gpsSatellites.gsaByKey, group.talkerId);
      const withUsed = withUsedInFix(group.satellites, gsaInfo?.usedPrns ?? []);
      for (const sat of withUsed) {
        if (sat.elevationDeg === null || sat.azimuthDeg === null) continue;
        const [x, y] = skyPos(sat.elevationDeg, sat.azimuthDeg);
        list.push({ id: `${group.key}-${sat.prn}`, prn: sat.prn, x, y, color, usedInFix: sat.usedInFix });
      }
    }
    return list;
  });

  // Tracked (present in a GSV list) but with no usable position yet --
  // counted rather than silently vanishing from the display, same
  // "nothing disappears without explanation" convention the rest of this
  // monitor already follows (e.g. nmeaFix.ts freezing last-known state).
  const noPositionCount = $derived.by(() =>
    groups.reduce(
      (sum, group) =>
        sum + group.satellites.filter((s) => s.elevationDeg === null || s.azimuthDeg === null).length,
      0,
    ),
  );

  // Legend only lists systems that actually have at least one satellite
  // right now -- an empty legend entry for a constellation with zero
  // satellites would just be noise.
  const legendEntries: LegendEntry[] = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const group of groups) {
      if (group.satellites.length === 0) continue;
      const name = describeConstellation(group.talkerId);
      if (!seen.has(name)) seen.set(name, constellationColor(name));
    }
    return [...seen.entries()].map(([name, color]) => ({ name, color }));
  });
</script>

<div class="skyplot">
  {#if noData}
    <div class="hint emptyhint">No satellite data yet.</div>
  {:else}
    <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
      {#each RING_ELEVATIONS as elevationDeg (elevationDeg)}
        <circle class="ring" cx={CX} cy={CY} r={ringRadius(elevationDeg)} />
      {/each}
      <text class="cardinal" x={CX} y={CY - OUTER_R - 8}>N</text>
      <text class="cardinal" x={CX + OUTER_R + 8} y={CY}>E</text>
      <text class="cardinal" x={CX} y={CY + OUTER_R + 8}>S</text>
      <text class="cardinal" x={CX - OUTER_R - 8} y={CY}>W</text>
      {#each plotted as sat (sat.id)}
        <circle
          class="satdot"
          class:outline={!sat.usedInFix}
          cx={sat.x}
          cy={sat.y}
          r={SAT_DOT_R}
          fill={sat.usedInFix ? sat.color : 'none'}
          stroke={sat.usedInFix ? 'none' : sat.color}
        />
        <text class="satlabel" x={sat.x} y={sat.y - SAT_DOT_R - 2}>{sat.prn}</text>
      {/each}
    </svg>
    {#if legendEntries.length > 0}
      <div class="legend">
        {#each legendEntries as entry (entry.name)}
          <span class="legenditem"><span class="swatch" style:background={entry.color}></span>{entry.name}</span>
        {/each}
      </div>
      <div class="usedhint">
        <span class="usedglyph filled"></span>used in fix &nbsp;&nbsp;<span class="usedglyph outline"></span>visible only
      </div>
    {/if}
    {#if noPositionCount > 0}
      <div class="hint note">{noPositionCount} tracked, no position yet.</div>
    {/if}
  {/if}
</div>

<style>
  .skyplot {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Grid/flex items default to min-height:auto -- "at least as tall as
       my own content's natural size" -- which overrides even a `1fr`/
       fixed-height parent row and forces it (and the whole .satpanels
       grid row) to grow past its intended 260px budget once enough
       constellations make the legend below wrap to more lines than a
       2-constellation test ever exercised (confirmed live: a 4-
       constellation receiver bloated this to 657px and spilled over the
       GSA section below it, since the parent's `overflow: visible`
       doesn't clip an oversized grid row). This 0 override is what lets
       the SVG's own `flex: 1 1 auto; min-height: 0` below actually shrink
       to fit, instead of the legend/caption pushing the whole column
       (and its grid row) taller than the panel actually has room for. */
    min-height: 0;
    gap: 6px;
  }
  .skyplot svg {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: block;
  }
  .ring {
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
  .satdot {
    /* fill/stroke themselves are set per-dot inline (used-vs-visible
       encoding, see the script's own comment) -- a CSS rule forcing
       `stroke: none` here would win over that per-element attribute for
       every dot regardless of value, since a stylesheet rule always beats
       a plain presentation attribute. Only the outline dots' stroke
       thickness is a fixed, shared style. */
    stroke-width: 1.3;
  }
  .satlabel {
    fill: var(--ink);
    font-size: 6px;
    font-weight: 600;
    text-anchor: middle;
  }
  .legend {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 11px;
    color: var(--muted);
  }
  .legenditem {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  /* One-line caption explaining the filled-vs-outline dot encoding above
     -- monochrome (var(--muted)/var(--ink)), deliberately NOT colored per
     constellation, since this is explaining the used-vs-visible signal
     specifically, orthogonal to the color legend just above it. */
  .usedhint {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--muted);
    display: flex;
    align-items: center;
  }
  .usedglyph {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
    box-sizing: border-box;
  }
  .usedglyph.filled {
    background: var(--ink);
  }
  .usedglyph.outline {
    background: none;
    border: 1.3px solid var(--ink);
  }
  .hint {
    color: var(--muted);
    font-style: italic;
  }
  .emptyhint {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .note {
    flex: 0 0 auto;
    font-size: 11px;
    text-align: center;
  }
</style>
