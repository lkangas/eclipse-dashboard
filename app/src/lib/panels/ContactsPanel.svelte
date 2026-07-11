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

  function formatAlt(altitude: number): string {
    return `${altitude.toFixed(1)}°`;
  }
  function formatAz(azimuth: number): string {
    return `${Math.round(azimuth)}°`;
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
  const nextKey = $derived(
    rows.find((r) => r.date.getTime() >= $effectiveTime.getTime())?.key ?? null,
  );

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
      {#each rows as row (row.key)}
        <tr class:next={row.key === nextKey}>
          <td>{row.label}</td>
          <td class="num">{row.offset}</td>
          <td class="num">{row.time}</td>
          <td class="num">{row.alt}</td>
          <td class="num">{row.az}</td>
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
