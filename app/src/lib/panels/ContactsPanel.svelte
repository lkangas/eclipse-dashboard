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
  // Global circumstances (PLAN.md §9 "global circumstances toggle") --
  // the eclipse's whole-Earth timeline (first/last penumbral & umbral
  // contact, central line begin/end, extreme N/S limits, greatest
  // eclipse), independent of this observer, from the ytliu-style
  // "Eclipse Times" table (precomputed via eclipse-calc, not client-
  // side -- these are fixed whole-event facts, not this-observer- or
  // clock-dependent). Off by default -- opt-in via the "Global" toggle
  // in the bottom ribbon, never filtered by local sunset (unlike the
  // local rows above: these aren't about what's visible from here).
  // Trimmed to the standard
  // contact-time events only (P1/P4, U1-U4, GE) -- the central-line
  // begin/end and extreme N/S-limit points that eclipse-times.json also
  // carries are left out of this table by direct request (not deleted
  // from the data, just not shown here).
  let showGlobal = $state(false);
  const GLOBAL_KEYS = new Set(['p1', 'u1', 'u2', 'u3', 'u4', 'ge', 'p4']);
  const globalEvents = $derived.by(() => {
    return eclipseTimesData.events
      .filter((e) => GLOBAL_KEYS.has(e.key))
      .map((e) => {
        const date = new Date(e.utMs);
        return {
          key: 'g-' + e.key,
          label: e.key.toUpperCase(),
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
  // "Next" tracks whichever row is chronologically next among whatever's
  // actually displayed -- local-only when the toggle is off, the full
  // merged local+global timeline when it's on, so a global row can be
  // "next" too rather than only ever passively sitting there with no
  // sense of past/next/future.
  const nextKey = $derived(
    displayRows.find((r) => r.date.getTime() >= $effectiveTime.getTime())?.key ?? null,
  );
  // Of the standard 16-row table, 5 are missing on purpose (a near-polar
  // tangent-search convergence gap, not a bug) -- see eclipse-times.json's
  // own "omitted" array (with the specific numbers/reasons per event) and
  // NOTICE.md. Surfaced as a plain count with the detail in a title
  // tooltip rather than another table, matching this panel's existing
  // ".provisional"-style honesty-about-gaps convention.
  const omittedNote = eclipseTimesData.omitted
    .map((o: { label: string; reason: string }) => `${o.label}: ${o.reason}`)
    .join('\n\n');

  // Natural (scale-1) height of whatever's currently in the table, used
  // by the CSS below to shrink rows to fit tablewrap's actual available
  // space instead of scrolling -- see .tablewrap's --tscale-table
  // comment for why this has to be measured per row-type rather than a
  // single constant. Header/local-row/global-row heights (28/32/46px)
  // are measured from the rendered table at scale 1, not derived from
  // the padding/font-size literals below (duplicated, but simpler than
  // keeping two representations of the same box-model in sync).
  const HEADER_H = 28;
  const LOCAL_ROW_H = 32;
  const GLOBAL_ROW_H = 46;
  const naturalTableH = $derived.by(() => {
    const rowBorders = 1 + rows.length + (showGlobal ? globalEvents.length : 0);
    const base =
      HEADER_H + rows.length * LOCAL_ROW_H + (showGlobal ? globalEvents.length * GLOBAL_ROW_H : 0);
    // Each row's 1px border-bottom doesn't shrink with --tscale-table
    // (fractional CSS borders round inconsistently across browsers), so
    // the real rendered height at scale<1 comes out a little taller
    // than a purely linear (height-at-scale-1 * scale) estimate would
    // predict -- by up to ~1px per row/header boundary. A small buffer
    // here keeps the shrink-to-fit calc's target slightly under the
    // true content height instead of landing right at it, so rounding
    // can't tip it over into a (for the local-only view, unwanted)
    // scrollbar.
    return base + rowBorders * 2;
  });

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
  <div class="tablewrap" class:crowded={showGlobal} style="--natural-h: {naturalTableH}px">
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
          <tr
            class:next={row.key === nextKey}
            class:past={row.key !== nextKey && row.date.getTime() < $effectiveTime.getTime()}
            class:global={!row.isLocal}
          >
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
  </div>
  <div class="circ">
    <div><span>Duration</span><b>{durationText}</b></div>
    <div><span>Obsc. (linear)</span><b>{linearObscurationText}</b></div>
    <div><span>Obsc. (area)</span><b>{areaObscurationText}</b></div>
    <div><span>Sun alt</span><b>{sunAltText}</b></div>
    <div><span>Sun az</span><b>{sunAzText}</b></div>
    <div class="globalgroup">
      {#if showGlobal}
        <span class="omitted" title={omittedNote}>5 omitted</span>
      {/if}
      <button class="globaltoggle" class:on={showGlobal} onclick={() => (showGlobal = !showGlobal)}>
        Global
      </button>
    </div>
  </div>
</div>

<style>
  /* Sized off native CSS container-query units (cqw/cqh) -- these are
     PHYSICALLY zoom-invariant on their own: a panel that's a fixed
     proportion of the window stays that same proportion at any zoom,
     automatically. Requires the nearest ancestor (App.svelte's .pane) to
     set container-type: size. Governs the chrome (padding + the bottom
     ribbon) only -- the table has its own --tscale-table below, since a
     single whole-pane-height threshold can't tell whether the table
     itself is actually cramped (see that comment for the full story). */
  .contacts {
    --tscale: max(0.4, min(1, calc(100cqw / 300px), calc(100cqh / 200px)));
    height: 100%;
    padding: calc(14px * var(--tscale)) 14px calc(8px * var(--tscale));
    display: flex;
    flex-direction: column;
  }
  /* The table shrinks to fit tablewrap's actual available height
     (--tscale-table, a min(1, cqh / natural-content-height) factor) --
     NOT a scrollbar -- for the local-only view: with at most ~6 rows,
     it always fits at *some* legible-to-tiny scale, so a scrollbar
     should never appear there. min(1, ...) has no floor, deliberately:
     the whole point is to guarantee a fit, however small, rather than
     ever leave a gap that forces a scrollbar. `--natural-h` (set as an
     inline style from the component, computed from the actual row
     count/types currently displayed) stands in for "how tall would this
     render at scale 1" -- container queries can't measure a sibling's
     content size directly. With global events added (`.crowded`, up to
     ~17 rows of two different heights), full shrink-to-fit would make
     text illegibly small on anything but a tall panel, so that variant
     re-adds the old 0.4 floor and accepts a scrollbar (tablewrap's
     `overflow-y: auto`) below it instead -- this is the case a plain
     magic-number threshold used to get wrong (see git history): it
     started shrinking rows before tablewrap's own leftover slack had
     actually run out, because the threshold was sized for the whole
     pane, not for how cramped the table itself was. Keying off the
     table's own natural content height instead fixes that at the root,
     for both the floored and unfloored cases. */
  .tablewrap {
    --tscale-table: min(1, calc(100cqh / var(--natural-h, 220px)));
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    container-type: size;
  }
  .tablewrap.crowded {
    --tscale-table: max(0.4, min(1, calc(100cqh / var(--natural-h, 220px))));
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: calc(14px * var(--tscale-table));
  }
  td,
  th {
    padding: calc(6px * var(--tscale-table)) 10px;
    text-align: left;
    border-bottom: 1px solid var(--line);
  }
  th {
    position: sticky;
    top: 0;
    background: var(--screen);
    color: var(--muted);
    font-weight: 500;
    font-size: calc(11px * var(--tscale-table));
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
  /* Already happened, relative to effectiveTime -- applies across local
     and global rows alike (past/next/future is a property of the row's
     own timestamp, not of which kind of row it is). */
  tr.past td {
    opacity: 0.5;
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
    font-size: calc(12px * var(--tscale-table));
  }
  .pos {
    display: block;
    font-size: calc(10px * var(--tscale-table));
    color: var(--muted);
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
  /* Pinned to the ribbon's right edge via margin-left: auto -- the only
     item in .circ that isn't a Duration/Obsc./Sun-alt-az stat, so it
     reads as a separate control rather than another value in the row.
     Selector is `.circ .globalgroup`, not just `.globalgroup`, to
     out-specificity `.circ div` below (which would otherwise force this
     into the stats' column layout instead of a horizontal button+badge
     pair). */
  .circ .globalgroup {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .circ {
    flex-shrink: 0;
    display: flex;
    align-items: center;
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
