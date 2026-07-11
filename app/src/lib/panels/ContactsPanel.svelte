<script lang="ts">
  // STUB data (Zaragoza reference), ported verbatim from
  // design/layout-v3-fullscreen.html. Real computation (findContactTimes
  // against the live observer) is a follow-up slice.
  const rows = [
    { event: 'C1', t: '+53:23', time: '19:35:00', alt: '—', next: false },
    { event: 'C2', t: '−00:41.6', time: '20:29:04', alt: '—', next: true },
    { event: 'Max', t: '−01:21', time: '20:29:44', alt: '5.9°', next: false },
    { event: 'C3', t: '−02:05', time: '20:30:28', alt: '—', next: false },
    { event: 'C4', t: '−53:37', time: '21:22:00', alt: '—', next: false },
    { event: 'Sunset', t: '−51:37', time: '21:20:00', alt: '0°', next: false },
  ];
  const circ = [
    { label: 'Duration', value: '1m 24s' },
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
      {#each rows as row (row.event)}
        <tr class:next={row.next}>
          <td>{row.event}</td>
          <td class="num">{row.t}</td>
          <td class="num">{row.time}</td>
          <td class="num">{row.alt}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="circ">
    {#each circ as item (item.label)}
      <div><span>{item.label}</span><b>{item.value}</b></div>
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
</style>
