<script lang="ts">
  // Real contact times for the live observer (PLAN.md §4), replacing the
  // Zaragoza-reference stub. Alt (needs astronomy-engine) and Sunset
  // (needs eclipse_calc.terminator, not yet ported) aren't available yet
  // -- shown as "--"/omitted rather than left as stale stub numbers.
  // Magnitude/Obscuration/Sun az have no oracle at all yet (PLAN.md §4/§14
  // #6) -- kept as placeholder values, visually flagged provisional.
  import { localCircumstances } from '../../stores/localCircumstances';
  import { effectiveTime } from '../../stores/clock';
  import { formatCountdown, formatDurationSeconds, formatCest } from '../format';

  const EVENTS = [
    { key: 'c1', label: 'C1' },
    { key: 'c2', label: 'C2' },
    { key: 'max', label: 'Max' },
    { key: 'c3', label: 'C3' },
    { key: 'c4', label: 'C4' },
  ] as const;

  const rows = $derived(
    EVENTS.map(({ key, label }) => {
      const date = $localCircumstances[key];
      return {
        key,
        label,
        date,
        time: date ? formatCest(date) : '—',
        offset: date ? formatCountdown((date.getTime() - $effectiveTime.getTime()) / 1000) : '—',
      };
    }),
  );
  const nextKey = $derived(
    rows.find((r) => r.date && r.date.getTime() >= $effectiveTime.getTime())?.key ?? null,
  );

  const durationText = $derived(
    $localCircumstances.durationS !== null
      ? formatDurationSeconds($localCircumstances.durationS)
      : 'no totality here',
  );

  const circ = [
    { label: 'Magnitude', value: '1.039' },
    { label: 'Obscuration', value: '100%' },
    { label: 'Sun az', value: '296°' },
  ];
</script>

<div class="contacts">
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th class="num">T</th>
        <th class="num">Time</th>
        <th class="num">Alt</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.key)}
        <tr class:next={row.key === nextKey}>
          <td>{row.label}</td>
          <td class="num">{row.offset}</td>
          <td class="num">{row.time}</td>
          <td class="num">—</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="circ">
    <div><span>Duration</span><b>{durationText}</b></div>
    {#each circ as item (item.label)}
      <div class="provisional" title="Not yet computed for this observer -- placeholder value">
        <span>{item.label}</span><b>{item.value}<sup>†</sup></b>
      </div>
    {/each}
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
  .circ .provisional b {
    color: var(--muted);
  }
  .circ .provisional sup {
    font-size: 0.7em;
    cursor: help;
  }
</style>
