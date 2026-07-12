<script lang="ts">
  // Real contact times for the live observer (PLAN.md §4), replacing the
  // Zaragoza-reference stub.
  //
  // Sunset is real (astronomy-engine, stores/localCircumstances.ts) and
  // interleaved chronologically among C1-C4/Max rather than always
  // last -- this event is sunset-limited for Spain (PLAN.md §1), so the
  // Besselian shadow-cone geometry alone (no concept of the horizon)
  // can and does place C3/C4 -- sometimes even C2/Max -- after the sun
  // has actually set here. Rows after sunset are dropped entirely, not
  // just flagged: they're not observable, so they don't belong in a
  // table of what you can actually see.
  import { localCircumstances } from '../../stores/localCircumstances';
  import { effectiveTime } from '../../stores/clock';
  import { obscuration } from '../../stores/obscuration';
  import { observer } from '../../stores/observer';
  import { skyView, sunAltAzAt } from '../../stores/skyView';
  import { formatCountdown, formatDurationSeconds, formatCest } from '../format';
  import eclipseTimesData from '../../data/eclipse-times.json';

  function formatAlt(altitude: number): string {
    return `${altitude.toFixed(1)}°`;
  }
  function formatAz(azimuth: number): string {
    return `${Math.round(azimuth)}°`;
  }
  function formatLatLon(lat: number, lon: number): string {
    const ns = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
    const ew = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
    return `${ns} ${ew}`;
  }

  // Each row gets the Sun's own alt/az at ITS timestamp (not live "now"),
  // via sunAltAzAt -- the same Equator/Horizon math skyView's live value
  // uses, just evaluated once per event instant instead of reactively on
  // the clock. Sunset is computed the same uniform way as every other
  // row (no hardcoded "0°") -- it lands a little off exactly zero since
  // Horizon()'s 'normal' refraction model and SearchRiseSet's own fixed
  // 34' constant disagree slightly at the horizon (see skyView.ts's
  // horizonDepressionDeg comment), which is real and worth showing, not
  // papering over.
  const rows = $derived.by(() => {
    const lc = $localCircumstances;
    const sunsetMs = lc.sunset ? lc.sunset.getTime() : null;
    const candidates: { key: string; label: string; date: Date | null }[] = [
      { key: 'c1', label: 'C1', date: lc.c1 },
      { key: 'c2', label: 'C2', date: lc.c2 },
      { key: 'max', label: 'Max', date: lc.max },
      { key: 'c3', label: 'C3', date: lc.c3 },
      { key: 'c4', label: 'C4', date: lc.c4 },
      { key: 'sunset', label: 'Sunset', date: lc.sunset },
    ];
    return candidates
      .filter((r): r is { key: string; label: string; date: Date } => r.date !== null)
      .filter((r) => r.key === 'sunset' || sunsetMs === null || r.date.getTime() <= sunsetMs)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((r) => {
        const altAz = sunAltAzAt(r.date, $observer.lat, $observer.lon, $observer.elevationM);
        return {
          key: r.key,
          label: r.label,
          date: r.date,
          time: formatCest(r.date),
          alt: formatAlt(altAz.altitude),
          az: formatAz(altAz.azimuth),
          offset: formatCountdown((r.date.getTime() - $effectiveTime.getTime()) / 1000),
        };
      });
  });
  // "Next" always tracks the next LOCAL row, even with global events
  // interleaved below -- it answers "what's coming up for me", a
  // local-only question, so a global row (which can easily land
  // chronologically between two local ones) never steals the highlight.
  const nextKey = $derived(
    rows.find((r) => r.date.getTime() >= $effectiveTime.getTime())?.key ?? null,
  );

  // Global circumstances (PLAN.md §9 "global circumstances toggle") --
  // the eclipse's whole-Earth timeline (first/last penumbral & umbral
  // contact, central line begin/end, extreme N/S limits, greatest
  // eclipse), independent of this observer, from the ytliu-style
  // "Eclipse Times" table (precomputed via eclipse-calc, not client-
  // side -- these are fixed whole-event facts, not this-observer- or
  // clock-dependent). Off by default -- opt-in via the toggle below,
  // never filtered by local sunset (unlike the local rows above: these
  // aren't about what's visible from here). `c1`/`c2` in the source data
  // mean the GLOBAL central line's begin/end (a real naming collision
  // with the LOCAL c1/c2 keys above -- this observer's 2nd/3rd contact),
  // so relabeled CL1/CL2 for display only; every other key already
  // matches its own short display code (ytliu/NASA/EclipseWise's own
  // convention, e.g. "u1", "su1", "ge").
  let showGlobal = $state(false);
  const GLOBAL_LABEL_OVERRIDE: Record<string, string> = { c1: 'CL1', c2: 'CL2' };
  const globalEvents = $derived.by(() => {
    return eclipseTimesData.events.map((e) => {
      const date = new Date(e.utMs);
      return {
        key: 'g-' + e.key,
        label: GLOBAL_LABEL_OVERRIDE[e.key] ?? e.key.toUpperCase(),
        fullLabel: e.label,
        date,
        time: formatCest(date),
        posText: formatLatLon(e.lat, e.lon),
        offset: formatCountdown((date.getTime() - $effectiveTime.getTime()) / 1000),
        isLocal: false as const,
      };
    });
  });
  const displayRows = $derived.by(() => {
    const localRows = rows.map((r) => ({ ...r, fullLabel: r.label, posText: null, isLocal: true as const }));
    if (!showGlobal) return localRows;
    return [...localRows, ...globalEvents].sort((a, b) => a.date.getTime() - b.date.getTime());
  });
  // Of the standard 16-row table, 5 are missing on purpose (a near-polar
  // tangent-search convergence gap, not a bug) -- see eclipse-times.json's
  // own "omitted" array (with the specific numbers/reasons per event) and
  // NOTICE.md. Surfaced as a plain count with the detail in a title
  // tooltip rather than another table, matching this panel's existing
  // ".provisional"-style honesty-about-gaps convention.
  const omittedNote = eclipseTimesData.omitted
    .map((o: { label: string; reason: string }) => `${o.label}: ${o.reason}`)
    .join('\n\n');

  const durationText = $derived(
    $localCircumstances.durationS !== null
      ? formatDurationSeconds($localCircumstances.durationS)
      : 'no totality here',
  );

  // Live, not a per-event snapshot -- both update continuously with
  // effectiveTime (PLAN.md §4/§14 #6), derived from the same L1/L2/m
  // the contact-time root-finder above already uses (see
  // eclipse/localCircumstances.ts's obscurationAt for the math), not a
  // separate ephemeris lookup. Linear ("magnitude", classically) is
  // clamped to [0,1] for display -- it genuinely exceeds 100% at/near
  // mid-totality since the Moon's disk is bigger than the Sun's, which
  // reads as a bug rather than the honest number it is; area (what
  // fraction of the Sun's disk is actually hidden) is naturally already
  // bounded and the more meaningful of the two, kept unclamped/exact.
  const linearObscurationText = $derived(
    `${(Math.max(0, Math.min(1, $obscuration.linear)) * 100).toFixed(1)}%`,
  );
  const areaObscurationText = $derived(`${($obscuration.area * 100).toFixed(1)}%`);

  const sunAltText = $derived(formatAlt($skyView.sun.altitude));
  const sunAzText = $derived(formatAz($skyView.sun.azimuth));
</script>

<div class="contacts">
  <div class="tablehead">
    <button class="globaltoggle" class:on={showGlobal} onclick={() => (showGlobal = !showGlobal)}>
      {showGlobal ? 'Hide global events' : 'Show global events'}
    </button>
    {#if showGlobal}
      <span class="omitted" title={omittedNote}>5 omitted</span>
    {/if}
  </div>
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th class="num">T</th>
        <th class="num">Time</th>
        <th class="num">Alt</th>
        <th class="num">Az</th>
      </tr>
    </thead>
    <tbody>
      {#each displayRows as row (row.key)}
        <tr class:next={row.key === nextKey} class:global={!row.isLocal}>
          <td>
            <span title={row.fullLabel}>{row.label}</span>
            {#if row.posText}<span class="pos">{row.posText}</span>{/if}
          </td>
          <td class="num">{row.offset}</td>
          <td class="num">{row.time}</td>
          <td class="num">{row.isLocal ? row.alt : '—'}</td>
          <td class="num">{row.isLocal ? row.az : '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="circ">
    <div><span>Duration</span><b>{durationText}</b></div>
    <div><span>Obsc. (linear)</span><b>{linearObscurationText}</b></div>
    <div><span>Obsc. (area)</span><b>{areaObscurationText}</b></div>
    <div><span>Sun alt</span><b>{sunAltText}</b></div>
    <div><span>Sun az</span><b>{sunAzText}</b></div>
  </div>
</div>

<style>
  /* Sized off native CSS container-query units (cqw/cqh) -- these are
     PHYSICALLY zoom-invariant on their own: a panel that's a fixed
     proportion of the window stays that same proportion at any zoom,
     automatically. The real zoom-inconsistency risk is the FIXED PIXEL
     LITERALS this gets compared against (300px/340px below) -- left as
     plain literals deliberately: the shrink-to-fit floor only matters in
     the already-extreme small-panel case. Ceiling stays at 1 (never grows
     past plain 14px/11px/etc -- the table shouldn't grow past a
     comfortable reading size, unlike the countdown panel). Requires the
     nearest ancestor (App.svelte's .pane) to set container-type: size. */
  .contacts {
    --tscale: max(0.4, min(1, calc(100cqw / 300px), calc(100cqh / 340px)));
    padding: calc(14px * var(--tscale)) 14px calc(8px * var(--tscale));
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: calc(14px * var(--tscale));
  }
  td,
  th {
    padding: calc(6px * var(--tscale)) 10px;
    text-align: left;
    border-bottom: 1px solid var(--line);
  }
  th {
    color: var(--muted);
    font-weight: 500;
    font-size: calc(11px * var(--tscale));
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tr.next td {
    background: var(--accent-bg);
    color: var(--accent-ink);
    font-weight: 500;
  }
  /* Local rows (this observer's own C1-C4/Max/Sunset) get a colored left
     edge so they anchor the eye against interleaved global rows --
     deliberately a different color/mechanism from .next's accent-bg
     "what's coming up next" highlight above, so the two indicators (this
     row is local vs. this row is next) don't visually collide when both
     apply to the same row. */
  td:first-child {
    border-left: 3px solid transparent;
  }
  tr:not(.global) td:first-child {
    border-left-color: var(--cline);
  }
  tr.global td {
    color: var(--muted);
  }
  tr.global td.num {
    font-size: calc(12px * var(--tscale));
  }
  .pos {
    display: block;
    font-size: calc(10px * var(--tscale));
    color: var(--muted);
  }
  .tablehead {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: calc(6px * var(--tscale));
  }
  .globaltoggle {
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: calc(4px * var(--tscale)) calc(9px * var(--tscale));
    font-size: calc(11px * var(--tscale));
    font-weight: 500;
    color: var(--muted);
    cursor: pointer;
  }
  .globaltoggle.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
  }
  .omitted {
    font-size: calc(10px * var(--tscale));
    color: var(--muted);
    cursor: help;
    text-decoration: underline dotted;
  }
  .circ {
    display: flex;
    gap: 22px;
    flex-wrap: wrap;
    border-top: 1px solid var(--line);
    padding: calc(12px * var(--tscale)) 10px calc(6px * var(--tscale));
    margin-top: calc(6px * var(--tscale));
  }
  .circ div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .circ span {
    font-size: calc(11px * var(--tscale));
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .circ b {
    font-size: calc(15px * var(--tscale));
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
</style>
