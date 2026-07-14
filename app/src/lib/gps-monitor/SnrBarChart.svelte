<script lang="ts">
  // PLAN.md §6 phase 1 / §7: the SNR bar chart sibling to the (not yet
  // built, same phase) satellite sky-plot -- one vertical bar per
  // satellite currently tracked by the rich GSV parser, grouped by
  // constellation and sorted by PRN within each group. No props: reads
  // gpsSatellites directly (same direct-store-import convention the rest
  // of this app's panels use), so it can be dropped into the eventual
  // GpsMonitorPanel restructuring (deferred -- see that file's own
  // "not needed for a single-file phase 1" note in the plan) without any
  // wiring beyond mounting it.
  import { gpsSatellites } from '../../stores/gpsSatellites';
  import { describeConstellation } from '../../serial/monitor';
  import { findMatchingGsa, withUsedInFix } from '../../serial/nmeaSatellites';

  // Real GNSS receivers essentially never report anywhere near NMEA's
  // nominal 0-99 dB-Hz ceiling -- scaling bars against 99 would make every
  // real-world signal look like a sliver. 55 dB-Hz is a realistic
  // strong-signal ceiling instead; snrDb is clamped (not just divided) to
  // it below so a rare receiver reporting higher still draws a full-height
  // bar rather than overflowing the chart area.
  const CHART_MAX_DB = 55;

  // Same 6-constellation palette as the satellite sky-plot sibling
  // component (direct request), for visual consistency between the two
  // new panels -- BD is the older-receiver talker ID for BeiDou, GB the
  // newer one (see nmeaRich.ts's own talker-ID handling), both map to the
  // same color since they're the same constellation. Anything else
  // (GN's shared multi-constellation talker, or a talker this table
  // doesn't know) falls back to the app's own accent color rather than an
  // arbitrary guessed color.
  const CONSTELLATION_COLORS: Record<string, string> = {
    GP: '#4a90d9', // GPS
    GL: '#5cb85c', // GLONASS
    GA: '#f0ad4e', // Galileo
    GB: '#9b59b6', // BeiDou
    BD: '#9b59b6', // BeiDou (older receivers)
    GQ: '#e67e22', // QZSS
    GI: '#16a085', // NavIC
  };
  function constellationColor(talkerId: string): string {
    return CONSTELLATION_COLORS[talkerId] ?? 'var(--accent)';
  }

  interface Bar {
    barKey: string;
    prn: number;
    snrDb: number | null;
    usedInFix: boolean;
  }
  interface Group {
    talkerId: string;
    label: string;
    color: string;
    bars: Bar[];
  }

  // gpsSatellites.constellations is keyed by (talkerId, signalId) -- a
  // dual-frequency receiver emitting both an L1 and an L5 GSV run for the
  // same constellation shows up as two separate entries there (see
  // nmeaSatellites.ts's satelliteGroupKey). This chart groups purely by
  // constellation (talkerId), per the direct request -- signal-ID-aware
  // splitting is out of scope for phase 1 (PLAN.md §6 phase 4), so a
  // dual-frequency receiver's two signals just contribute their
  // satellites into the same bucket here, keyed uniquely per bar via
  // the source constellation's own `key` (which does include signalId)
  // rather than by PRN alone, so nothing collides.
  // usedInFix cross-reference (PLAN.md §5's "usedInFix cross-reference" /
  // §6 phase 2), same lookup pattern as the sky-plot sibling component:
  // find this constellation's matching full-GSA (by talkerId, falling
  // back to System-ID-derived name matching -- see findMatchingGsa's own
  // comment) and overlay its used-PRN list onto the GSV satellite list.
  // No match (the documented shared-talker/no-System-ID gap) -> usedPrns
  // defaults to [], which withUsedInFix naturally turns into "not used"
  // for every satellite in that group, rather than guessing.
  const groups = $derived.by((): Group[] => {
    const byTalker = new Map<string, Bar[]>();
    for (const constellation of Object.values($gpsSatellites.constellations)) {
      const matchingGsa = findMatchingGsa($gpsSatellites.gsaByKey, constellation.talkerId);
      const withUsage = withUsedInFix(constellation.satellites, matchingGsa?.usedPrns ?? []);
      const bars = byTalker.get(constellation.talkerId) ?? [];
      for (const sat of withUsage) {
        bars.push({
          barKey: `${constellation.key}-${sat.prn}`,
          prn: sat.prn,
          snrDb: sat.snrDb,
          usedInFix: sat.usedInFix,
        });
      }
      byTalker.set(constellation.talkerId, bars);
    }
    return Array.from(byTalker.entries())
      .map(([talkerId, bars]) => ({
        talkerId,
        label: describeConstellation(talkerId),
        color: constellationColor(talkerId),
        bars: bars.slice().sort((a, b) => a.prn - b.prn),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  const totalBars = $derived(groups.reduce((n, g) => n + g.bars.length, 0));

  // Fixed viewBox -- the chart's own footprint stays constant regardless
  // of how many satellites are currently tracked; only the bar/gap widths
  // shrink as the count grows (up to ~20-30 bars per the direct request),
  // via preserveAspectRatio scaling the whole thing to fit its container
  // same as the sky-plot sibling's own svg elements.
  const VB_WIDTH = 640;
  const VB_HEIGHT = 214;
  const MARGIN_X = 14;
  const GROUP_GAP = 14; // extra horizontal gap between constellation clusters
  const TOP_MARGIN = 22; // room for the chart-max ceiling line/label
  const BASELINE_Y = 148; // 0 dB-Hz
  const CHART_AREA_H = BASELINE_Y - TOP_MARGIN;
  const PRN_LABEL_Y = BASELINE_Y + 9;
  const GROUP_LABEL_Y = VB_HEIGHT - 6;
  const MIN_STUB_H = 2; // "tracked but no signal" bars -- still a visible slot, not omitted
  const MAX_BAR_W = 20;

  const availableWidth = $derived(VB_WIDTH - 2 * MARGIN_X - Math.max(0, groups.length - 1) * GROUP_GAP);
  const slotWidth = $derived(totalBars > 0 ? availableWidth / totalBars : 0);
  const barWidth = $derived(Math.max(2, Math.min(MAX_BAR_W, slotWidth * 0.6)));

  interface PositionedBar {
    barKey: string;
    prn: number;
    cx: number;
    barY: number;
    barHeight: number;
    color: string;
    usedInFix: boolean;
  }
  interface PositionedGroup {
    talkerId: string;
    label: string;
    color: string;
    labelX: number;
    bars: PositionedBar[];
  }

  const positionedGroups = $derived.by((): PositionedGroup[] => {
    let cursor = MARGIN_X;
    return groups.map((g) => {
      const bars: PositionedBar[] = g.bars.map((b) => {
        const cx = cursor + slotWidth / 2;
        cursor += slotWidth;
        const barHeight =
          b.snrDb === null
            ? MIN_STUB_H
            : Math.max(MIN_STUB_H, (Math.min(Math.max(b.snrDb, 0), CHART_MAX_DB) / CHART_MAX_DB) * CHART_AREA_H);
        return {
          barKey: b.barKey,
          prn: b.prn,
          cx,
          barY: BASELINE_Y - barHeight,
          barHeight,
          color: b.snrDb === null ? 'var(--muted)' : g.color,
          usedInFix: b.usedInFix,
        };
      });
      const groupStart = cursor - g.bars.length * slotWidth;
      const groupEnd = cursor;
      cursor += GROUP_GAP;
      return { talkerId: g.talkerId, label: g.label, color: g.color, labelX: (groupStart + groupEnd) / 2, bars };
    });
  });
</script>

<div class="snrchart">
  {#if totalBars === 0}
    <div class="hint">No satellite data yet.</div>
  {:else}
    <svg viewBox="0 0 {VB_WIDTH} {VB_HEIGHT}" preserveAspectRatio="xMidYMid meet">
      <line class="ceiling" x1={MARGIN_X} y1={TOP_MARGIN} x2={VB_WIDTH - MARGIN_X} y2={TOP_MARGIN} />
      <text class="ceilinglabel" x={MARGIN_X} y={TOP_MARGIN - 6}>{CHART_MAX_DB} dB-Hz</text>
      <line class="baseline" x1={MARGIN_X} y1={BASELINE_Y} x2={VB_WIDTH - MARGIN_X} y2={BASELINE_Y} />

      {#each positionedGroups as group (group.talkerId)}
        {#each group.bars as bar (bar.barKey)}
          <!-- usedInFix encoding (PLAN.md §6 phase 2 / §2's "Corrections
               from an actual screenshot"): matches the sky-plot sibling
               component's own choice (solid vs. outline-only) rather than
               an opacity treatment, for a consistent visual language
               across both new panels. A satellite actually used in the
               fix gets a SOLID bar in its constellation color; a
               visible-but-unused satellite gets an OUTLINE-only bar --
               stroke in the same constellation color, no fill -- so it
               still reads as "which system" at a glance, just visually
               lighter for "not contributing to the fix." -->
          <rect
            class="bar"
            class:outline={!bar.usedInFix}
            x={bar.cx - barWidth / 2}
            y={bar.barY}
            width={barWidth}
            height={bar.barHeight}
            fill={bar.usedInFix ? bar.color : 'none'}
            stroke={bar.usedInFix ? 'none' : bar.color}
          />
          <text
            class="prnlabel"
            x={bar.cx}
            y={PRN_LABEL_Y}
            transform="rotate(-60 {bar.cx} {PRN_LABEL_Y})"
            text-anchor="end"
          >
            {bar.prn}
          </text>
        {/each}
        <text class="grouplabel" x={group.labelX} y={GROUP_LABEL_Y} fill={group.color}>{group.label}</text>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .snrchart {
    height: 100%;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
  }
  .snrchart svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .hint {
    margin: auto;
    color: var(--muted);
    font-style: italic;
    font-size: 13px;
  }
  .ceiling {
    stroke: var(--line);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .ceilinglabel {
    fill: var(--muted);
    font-size: 8px;
  }
  .baseline {
    stroke: var(--line);
    stroke-width: 1;
  }
  .bar {
    /* Snappy but not instant -- a bar growing/shrinking as SNR updates
       reads as "live signal", not a jump-cut, without smearing across
       several epochs the way a longer transition would. */
    transition:
      height 180ms ease-out,
      y 180ms ease-out;
    /* fill/stroke themselves are set per-bar inline (used-vs-visible
       encoding, see the template's own comment) -- only the outline bars'
       stroke thickness is a fixed, shared style, same convention the
       sky-plot sibling's own .satdot rule uses for the same reason. */
    stroke-width: 1.3;
  }
  .prnlabel {
    font-size: 8px;
    font-variant-numeric: tabular-nums;
    fill: var(--muted);
  }
  .grouplabel {
    font-size: 10px;
    font-weight: 600;
    text-anchor: middle;
  }
</style>
