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
  import { horizonObstruction } from '../../stores/horizonObstruction';
  import { formatCountdown, formatDurationSeconds, formatCest } from '../format';
  import { buildTimesJson, downloadTimesJson } from '../exportTimes';
  import eclipseTimesData from '../../data/eclipse-times.json';

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
        const obstruction = $horizonObstruction.contacts.find((c) => c.key === r.key);
        return {
          key: r.key,
          label: r.label,
          date: r.date,
          time: formatCest(r.date),
          alt: formatAlt(altAz.altitude),
          az: formatAz(altAz.azimuth),
          offset: formatCountdown((r.date.getTime() - $effectiveTime.getTime()) / 1000),
          obstructedByTerrain: obstruction?.obstructed ?? false,
        };
      });
  });
  // Horizon-obstruction warning (docs/HORIZON-PLAN.md): derived from `rows`
  // (already sunset-filtered) rather than horizonObstruction's own raw
  // contact list directly, so a contact that's already dropped for being
  // non-observable after sunset never also shows up here as "blocked by
  // terrain" -- redundant and confusing, since it's already not shown at
  // all for a different reason.
  const obstructedLabels = $derived(
    rows.filter((r) => r.obstructedByTerrain).map((r) => r.label).join(', '),
  );
  const anyObstructed = $derived(rows.some((r) => r.obstructedByTerrain));
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
  // from the data, just not shown here). Each row's own lat/lon (also in
  // eclipse-times.json) is deliberately not displayed either (direct
  // request, unnecessary here) -- the table is about *when*, not where
  // on Earth each global event occurs.
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
          offset: formatCountdown((date.getTime() - $effectiveTime.getTime()) / 1000),
          isLocal: false as const,
        };
      });
  });
  const displayRows = $derived.by(() => {
    const localRows = rows.map((r) => ({ ...r, fullLabel: r.label, isLocal: true as const }));
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
  // Natural (scale-1) height of whatever's currently in the table, used
  // by the CSS below to shrink rows to fit tablewrap's actual available
  // space instead of scrolling -- see .tablewrap's --tscale-table
  // comment for why this has to be measured per row-type rather than a
  // single constant. No header row anymore (direct request -- deleted
  // entirely for the extra space, column meanings are self-evident from
  // the values themselves). Local/global-row heights (32/46px) are
  // measured from the rendered table at scale 1, not derived from the
  // padding/font-size literals below (duplicated, but simpler than
  // keeping two representations of the same box-model in sync).
  const LOCAL_ROW_H = 32;
  const GLOBAL_ROW_H = 46;
  const naturalTableH = $derived.by(() => {
    const rowBorders = rows.length + (showGlobal ? globalEvents.length : 0);
    const base = rows.length * LOCAL_ROW_H + (showGlobal ? globalEvents.length * GLOBAL_ROW_H : 0);
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

  // Export as the JSON schema third-party eclipse-photography tooling
  // expects (direct request) -- see lib/exportTimes.ts's own comment.
  // Only needs C1/C4 (any partial eclipse's own start/end) -- totality
  // (C2/C3) is exported as null when this observer sees no totality,
  // rather than blocking the export entirely on it existing.
  const canExportTimes = $derived(
    $localCircumstances.c1 !== null && $localCircumstances.c4 !== null,
  );
  function exportTimes() {
    const lc = $localCircumstances;
    if (!lc.c1 || !lc.c4) return;
    void downloadTimesJson(buildTimesJson(lc.c1, lc.c2, lc.max, lc.c3, lc.c4));
  }

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
  {#if anyObstructed}
    <div
      class="obstructionwarning"
      title="Distant-terrain estimate from the bundled elevation grid only -- it can't see nearby trees, buildings, or small local terrain. Always verify the real horizon on site."
    >
      ⚠ Terrain may block {obstructedLabels}
    </div>
  {/if}
  <div class="tablewrap" class:crowded={showGlobal} style="--natural-h: {naturalTableH}px">
    <table>
      <tbody>
        {#each displayRows as row (row.key)}
          <tr
            class:next={row.key === nextKey}
            class:past={row.key !== nextKey && row.date.getTime() < $effectiveTime.getTime()}
            class:global={!row.isLocal}
            class:obstructed={row.isLocal && row.obstructedByTerrain}
          >
            <td>
              <span title={row.fullLabel}>{row.label}</span>
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
    <button
      class="exportbtn"
      disabled={!canExportTimes}
      onclick={exportTimes}
      title={canExportTimes
        ? 'Save this observer\'s C1/C2/Max/C3/C4 as times.json (komakallio/eclipse2024 schema) -- C2/C3 null if no totality here'
        : 'No eclipse visible from this location -- nothing to export'}
    >
      Save JSON
    </button>
    <button class="globaltoggle" class:on={showGlobal} onclick={() => (showGlobal = !showGlobal)}>
      Global
    </button>
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
     content size directly.

     With global events added (`.crowded`, up to ~17 rows), the opposite
     rule applies: --tscale-table is pinned to 1 -- NEVER shrink -- and
     `overflow-y: auto` (below) shows a scrollbar instead once the rows
     don't fit. An earlier version shrank this case too (down to a 0.4
     floor before scrolling), which read as the table visibly "zooming"
     every time the toggle was flipped on -- reported back as wrong: the
     two views want opposite trade-offs (local: shrink, never scroll;
     global: never shrink, scroll instead), not the same formula with a
     different floor. */
  .tablewrap {
    --tscale-table: min(1, calc(100cqh / var(--natural-h, 220px)));
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    container-type: size;
  }
  .tablewrap.crowded {
    --tscale-table: 1;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: calc(14px * var(--tscale-table));
  }
  td {
    padding: calc(6px * var(--tscale-table)) 10px;
    text-align: left;
    border-bottom: 1px solid var(--line);
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
  /* Terrain-obstruction flag (docs/HORIZON-PLAN.md) -- same #c22 warning
     color TopBar's own elevation-out-of-bounds flag uses, for one
     consistent "coarse/uncertain data, pay attention" visual language
     across the app rather than a second ad-hoc warning color. Overrides
     the plain local-row accent border above (placed after it, same
     specificity) since an obstructed row needs the warning to read first. */
  tr.obstructed td:first-child {
    border-left-color: #c22;
  }
  tr.obstructed td:first-child span {
    color: #c22;
    font-weight: 600;
  }
  .obstructionwarning {
    flex-shrink: 0;
    font-size: calc(12px * var(--tscale));
    font-weight: 600;
    color: #c22;
    padding: 0 0 calc(4px * var(--tscale));
    cursor: help;
  }
  /* Both pinned to the ribbon's right edge as one group -- margin-left:
     auto on the FIRST of the two (exportbtn) pushes both it and its
     sibling globaltoggle rightward, so they read as separate controls
     from the Duration/Obsc./Sun-alt-az stats rather than another value in
     the row. No specificity fight with .circ div below despite both
     applying margin/layout here: that selector only matches <div>
     children, and these are <button>s. */
  .exportbtn,
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
  .exportbtn {
    margin-left: auto;
  }
  .exportbtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .globaltoggle.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
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
