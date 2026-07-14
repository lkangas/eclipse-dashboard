<script lang="ts">
  // Fullscreen NMEA diagnostics overlay (direct request -- "the nmea
  // monitor box is also unusable [as a small dropdown]... a panel as
  // comprehensive as [a dedicated NMEA monitor tool] would be nice, but
  // we could start prototyping first with just a few fields"). Shows the
  // fields nmeaFix.ts tracks (fix quality, 2D/3D fix type, UTC, lat/lon,
  // altitude, satellites, HDOP) plus an epoch-rate readout/pulse -- not
  // the full GSV/VTG/GLL/ZDA breakdown a dedicated tool displays; parsing
  // those too is future work, not needed for this first pass.
  //
  // Independent of the four main panels' fullscreenPanel/PanelId
  // mechanism (stores/layout.ts, App.svelte) -- this isn't one of the
  // 2x2 grid panes, it's a standalone overlay triggered from GpsRibbon's
  // Monitor button, so it gets its own boolean store instead of forcing
  // a PanelId-shaped hole into that union for a single non-grid panel.
  import { gpsMonitorOpen } from '../stores/layout';
  import { gpsConnection } from '../serial/connection';
  import { describeFixQuality, describeFixType, applyLineToRows, initialLiveRowsState } from '../serial/monitor';
  // GPS-MONITOR-PLAN.md phase 1 (satellite sky-plot + SNR bar chart) and
  // phase 2 (per-constellation GsaPanel). All three are self-contained (no
  // props -- they subscribe to the gpsSatellites store directly, same
  // convention as this panel's own direct gpsConnection import above) and
  // render their own "No ... data yet." empty state, so nothing here needs
  // to know or care about the state of connection.ts's monitorActive gate.
  import SatelliteSkyPlot from './gps-monitor/SatelliteSkyPlot.svelte';
  import SnrBarChart from './gps-monitor/SnrBarChart.svelte';
  import GsaPanel from './gps-monitor/GsaPanel.svelte';

  function close() {
    gpsMonitorOpen.set(false);
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  const utcFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const statusText = $derived.by(() => {
    const s = $gpsConnection;
    if (s.status === 'error') return `Error -- ${s.error}`;
    if (s.status === 'connecting') return 'Connecting…';
    if (s.status === 'disconnecting') return 'Disconnecting…';
    if (s.status === 'idle') return 'Not connected';
    return s.fix.hasFix ? 'Connected' : 'Connected -- no fix yet';
  });

  // Staleness (bug report, adversarial review): fixRateHz/fixPulse only
  // ever update from a GGA arrival (connection.ts's applyLine) -- if a
  // receiver stops emitting GGA specifically while still sending
  // RMC/GSA, the connection stays 'connected' but the rate/pulse freeze
  // at their last real value forever, with nothing to say so. Detected
  // here at display time (not in connection.ts) via a plain local clock
  // tick, rather than adding a staleness timer to the connection module
  // itself -- this is purely "is what's already stored still meaningful
  // to show as live," not a change to what gets recorded.
  const STALE_MS = 3000;
  let liveNowMs = $state(Date.now());
  $effect(() => {
    if (!$gpsMonitorOpen) return;
    const interval = setInterval(() => (liveNowMs = Date.now()), 500);
    return () => clearInterval(interval);
  });
  const isStale = $derived(
    $gpsConnection.status === 'connected' &&
      $gpsConnection.lastFixEventMs !== null &&
      liveNowMs - $gpsConnection.lastFixEventMs > STALE_MS,
  );
  const rateText = $derived.by(() => {
    if (isStale) return 'stale';
    return $gpsConnection.fixRateHz === null ? '—' : `${$gpsConnection.fixRateHz.toFixed(1)} Hz`;
  });

  // Stick-to-bottom scroll -- same convention an earlier iteration of
  // this monitor used when it was still a small dropdown box (bug
  // report: it fought a manual scroll-up and snapped back to the bottom
  // on the very next line). Follows the newest line until the user
  // deliberately scrolls away, then stays put until they scroll back
  // down themselves. Only meaningful in 'scrolling' mode -- guarded below
  // so it's a no-op while 'live' mode's own (non-scrolling) box is shown.
  let monitorEl: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);
  function onMonitorScroll() {
    if (rawViewMode !== 'scrolling' || !monitorEl) return;
    const distanceFromBottom = monitorEl.scrollHeight - monitorEl.scrollTop - monitorEl.clientHeight;
    stickToBottom = distanceFromBottom < 24;
  }
  $effect(() => {
    if (rawViewMode !== 'scrolling') return;
    const lineCount = displayedLines.length;
    if ($gpsMonitorOpen && monitorEl && stickToBottom) {
      void lineCount; // establishes the reactive dependency
      monitorEl.scrollTop = monitorEl.scrollHeight;
    }
  });
  // Every fresh open starts pinned to the newest line -- the DOM node is
  // destroyed/recreated by the {#if $gpsMonitorOpen} block below, so
  // scrollTop wouldn't have persisted from a previous open anyway.
  $effect(() => {
    if (rawViewMode !== 'scrolling') return;
    if ($gpsMonitorOpen) stickToBottom = true;
  });

  // Raw-stream display mode -- PLAN.md §10's addendum: an optional
  // "Live rows" alternative to the scrolling firehose, where each
  // distinct sentence identity gets one row that updates in place.
  // 'scrolling' is the default so nothing changes visually for anyone who
  // never touches the toggle.
  let rawViewMode: 'scrolling' | 'live' = $state('scrolling');

  // Raw stream visibility/fullscreen/pause (direct requests: "hidden by
  // default and come out with a button, can be fullscreen then" + "a pause
  // button so that i can inspect what's happening" -- a u-blox M10 can
  // interleave binary UBX frames with NMEA text, which can garble the
  // line-split display unpredictably; pausing doesn't fix that, it just
  // lets the user freeze the view to inspect it).
  let streamVisible = $state(false);
  let streamFullscreen = $state(false);
  let paused = $state(false);
  let frozenLines: string[] | null = $state(null);

  function togglePause() {
    if (paused) {
      paused = false;
      frozenLines = null;
    } else {
      paused = true;
      // Capturing the current array reference is sufficient to freeze the
      // view -- recentLines is always replaced wholesale, never mutated in
      // place, so this reference can't change out from under us.
      frozenLines = $gpsConnection.recentLines;
    }
  }

  function hideStream() {
    streamVisible = false;
    streamFullscreen = false;
    // Collapsing starts fresh next time it's reopened -- same principle as
    // the "every fresh open starts pinned to the newest line" comment above.
    paused = false;
    frozenLines = null;
  }

  // Only the raw stream/live-rows display reads through this -- the fix
  // data, satellite panels, GSA panel, and Hz readout all keep reading
  // $gpsConnection directly further up, so they keep updating live even
  // while the stream itself is paused.
  const displayedLines = $derived(frozenLines ?? $gpsConnection.recentLines);

  // Replays the existing recentLines ring buffer (already capped, no new
  // buffer needed) through applyLineToRows every time it changes. A full
  // recompute rather than incremental tracking -- recentLines is already
  // small/bounded (capacity 40), so this is simpler and can't drift out
  // of sync with what's actually in the buffer.
  const liveRows = $derived.by(() => {
    let s = initialLiveRowsState;
    for (const line of displayedLines) s = applyLineToRows(s, line);
    return s;
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if $gpsMonitorOpen}
  <div class="gpsmonitor">
    <div class="header">
      <h2>GPS monitor</h2>
      <span class="statustag" class:warn={$gpsConnection.status === 'error'}>{statusText}</span>
      {#if $gpsConnection.baudRate !== null}
        <span class="baudtag">{$gpsConnection.baudRate} baud</span>
      {/if}
      {#if $gpsConnection.needsReload}
        <button
          class="reloadbtn"
          onclick={() => window.location.reload()}
          title="A known Chrome/Windows limitation prevents reopening this port without a fresh page load"
        >
          ⟳ Reload page
        </button>
      {/if}
      <span class="fill"></span>
      <div
        class="rate"
        title={isStale
          ? `No GGA sentence in over ${STALE_MS / 1000}s -- the receiver may have stopped sending position updates`
          : 'GGA sentence arrival rate, averaged over the last ~2.5s -- flashes on every epoch'}
      >
        {#key $gpsConnection.fixPulse}
          <span class="pulsedot" class:live={$gpsConnection.status === 'connected' && !isStale}></span>
        {/key}
        <span class="ratetext" class:stale={isStale}>{rateText}</span>
      </div>
      <button class="closebtn" onclick={close} title="Close (Esc)">✕</button>
    </div>

    {#if !streamFullscreen}
      <div class="fields">
        <div class="field"><span>Fix</span><b>{$gpsConnection.fix.hasFix ? describeFixQuality($gpsConnection.fix.fixQuality) : 'No fix'}</b></div>
        <div class="field"><span>Fix type</span><b>{describeFixType($gpsConnection.fix.fixType)}</b></div>
        <div class="field"><span>UTC</span><b>{$gpsConnection.fix.utc ? utcFmt.format($gpsConnection.fix.utc) : '—'}</b></div>
        <div class="field"><span>Latitude</span><b>{$gpsConnection.fix.lat !== null ? $gpsConnection.fix.lat.toFixed(6) : '—'}</b></div>
        <div class="field"><span>Longitude</span><b>{$gpsConnection.fix.lon !== null ? $gpsConnection.fix.lon.toFixed(6) : '—'}</b></div>
        <div class="field"><span>Altitude</span><b>{$gpsConnection.fix.altitudeM !== null ? `${$gpsConnection.fix.altitudeM.toFixed(1)} m` : '—'}</b></div>
        <div class="field"><span>Satellites</span><b>{$gpsConnection.fix.numSatellites ?? '—'}</b></div>
        <div class="field"><span>HDOP</span><b>{$gpsConnection.fix.hdop !== null ? $gpsConnection.fix.hdop.toFixed(1) : '—'}</b></div>
      </div>

      <!-- Satellite sky-plot + SNR bars, side by side on wide viewports and
           stacked on narrow ones (repeat(auto-fit, ...), same responsive
           pattern the .fields grid above already uses). Fixed height, not
           sharing .monitorbox's flex-grow, so the raw NMEA stream below
           keeps getting 100% of whatever vertical space is left over, same
           as before this section existed -- see .satpanels's own CSS
           comment for why. -->
      <div class="streamhead">Satellites</div>
      <div class="satpanels">
        <SatelliteSkyPlot />
        <SnrBarChart />
      </div>

      <!-- Per-constellation GSA (PLAN.md §6 phase 2 / §2's "two GNGSA panels
           side by side" reference idea) -- its own section below .satpanels
           rather than a third item squeezed into that row. GsaPanel renders
           a variable number of cards (one per constellation currently
           reporting a full-GSA sentence: 0 with no data yet, more as a
           multi-constellation receiver reports in) and, unlike
           SatelliteSkyPlot/SnrBarChart, doesn't fill a `height: 100%` --
           it's sized by its own content. Forcing that into .satpanels's
           fixed 260px row would mean either clipping a multi-constellation
           receiver's cards with no scroll affordance, or fighting the
           auto-fit grid for a share of a row built for exactly two
           fixed-height SVG panels. Content-sized instead (flex: 0 0 auto,
           same non-growing convention as .fields/.satpanels/.streamhead
           above), so it grows with however many constellations are
           reporting and simply pushes the raw NMEA stream down --
           .monitorbox below is still the one element that absorbs whatever
           vertical space is left over and scrolls internally, unchanged. -->
      <div class="streamhead">GSA (per constellation)</div>
      <div class="gsasection">
        <GsaPanel />
      </div>
    {/if}

    <!-- Raw NMEA stream: hidden by default (direct request -- it used to
         permanently eat most of this panel's vertical space even for
         someone who just wants to glance at the fields/satellite panels).
         streamVisible false shows a compact one-line expand affordance
         instead; once shown, its own header row carries Pause/Resume, a
         fullscreen toggle (hides everything above except the top .header
         row so .monitorbox gets nearly the whole panel body), and Hide. -->
    {#if streamVisible}
      <div class="streamheadrow">
        <div class="streamhead">Raw NMEA stream</div>
        <div class="viewtoggle">
          <button
            type="button"
            class="modebtn"
            class:on={rawViewMode === 'scrolling'}
            onclick={() => (rawViewMode = 'scrolling')}
          >Scrolling</button>
          <button
            type="button"
            class="modebtn"
            class:on={rawViewMode === 'live'}
            onclick={() => (rawViewMode = 'live')}
          >Live rows</button>
        </div>
        <span class="fill"></span>
        <button
          type="button"
          class="modebtn"
          class:on={paused}
          onclick={togglePause}
          title="Freeze the stream display to inspect it -- fix data, satellite panels, and Hz readout keep updating live"
        >{paused ? '▶ Resume' : '⏸ Pause'}</button>
        <button
          type="button"
          class="modebtn"
          class:on={streamFullscreen}
          onclick={() => (streamFullscreen = !streamFullscreen)}
        >{streamFullscreen ? '⛶ Exit' : '⛶ Fullscreen'}</button>
        <button type="button" class="modebtn" onclick={hideStream}>Hide</button>
      </div>
      {#if rawViewMode === 'scrolling'}
        <div class="monitorbox" bind:this={monitorEl} onscroll={onMonitorScroll}>
          {#each displayedLines as line, i (i)}
            <div class="monitorline">{line}</div>
          {/each}
          {#if displayedLines.length === 0}
            <div class="monitorline hint">No data yet.</div>
          {/if}
        </div>
      {:else}
        <div class="monitorbox">
          {#each liveRows.order as key (key)}
            {@const row = liveRows.rows[key]}
            <div class="monitorline liverow">
              <span class="liverowkey">{key}</span>{#key row.line}<span class="liverowline">{row.line}</span>{/key}
            </div>
          {/each}
          {#if liveRows.order.length === 0}
            <div class="monitorline hint">No data yet.</div>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="streamcollapsed">
        <button type="button" class="modebtn" onclick={() => (streamVisible = true)}>▸ Show raw NMEA stream</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .gpsmonitor {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--screen);
    display: flex;
    flex-direction: column;
    padding: 14px 18px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
  }
  .header h2 {
    margin: 0;
    font-size: 15px;
  }
  .statustag {
    font-size: 11px;
    color: var(--muted);
  }
  .statustag.warn {
    color: #c22;
  }
  .baudtag {
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .reloadbtn {
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    background: none;
    border: 1px solid #c22;
    border-radius: 4px;
    padding: 2px 8px;
    color: #c22;
    cursor: pointer;
  }
  .fill {
    flex: 1;
  }
  .rate {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pulsedot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--line);
  }
  .pulsedot.live {
    background: var(--accent);
    animation: pulseflash 220ms ease-out;
  }
  @keyframes pulseflash {
    0% {
      transform: scale(1.8);
      background: var(--live-ink);
    }
    100% {
      transform: scale(1);
      background: var(--accent);
    }
  }
  .ratetext {
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    font-weight: 600;
    min-width: 54px;
  }
  .ratetext.stale {
    color: #c22;
    font-variant-numeric: normal;
  }
  .closebtn {
    width: 26px;
    height: 26px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .closebtn:hover {
    border-color: var(--muted);
  }
  .fields {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px 20px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field span {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .field b {
    font-size: 16px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .streamhead {
    flex: 0 0 auto;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 12px 0 6px;
  }
  .streamheadrow {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .viewtoggle {
    display: flex;
    gap: 4px;
  }
  .modebtn {
    font: inherit;
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    cursor: pointer;
  }
  .modebtn.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
  }
  /* Compact stand-in shown instead of the whole raw-stream section while
     streamVisible is false -- same non-growing convention as the other
     top-level sections (flex: 0 0 auto), just a single expand affordance
     rather than the full header row + monitorbox. */
  .streamcollapsed {
    flex: 0 0 auto;
    padding: 12px 0 0;
  }
  .satpanels {
    /* flex: 0 0 auto with an explicit height (rather than a content-based
       auto flex-basis) is deliberate: flex-basis:auto defers to the
       height property when one is specified, so this gives the grid a
       definite, non-circular height to stretch its single row against --
       which is what lets SatelliteSkyPlot/SnrBarChart's own internal
       `height: 100%` resolve to something real instead of chasing an
       indeterminate auto size through their nested flex layouts. Fixed
       (flex-shrink: 0), not sharing growth with .monitorbox below, so the
       raw NMEA stream keeps getting 100% of whatever vertical space is
       left over, exactly as before this section existed -- same
       non-growing convention .fields/.header/this .streamhead already
       use, with .monitorbox as the one element that absorbs remaining
       space and scrolls internally.
       min-height: 0 (like .monitorbox) rather than the flex-item default
       auto-min-size, so this row can still shrink below its content's
       natural minimum on the rare very-short viewport instead of forcing
       .gpsmonitor's fixed, non-scrolling container to overflow the
       viewport.
       grid-template-columns is `auto 1fr`, not two equal `1fr` tracks
       (direct request: "the sky plot is unnecessarily wide since the
       plot ever needs a square aspect ratio... more room for the bar
       chart on the right"). SatelliteSkyPlot's own root element is
       `aspect-ratio: 1/1` with this row's fixed height, so the `auto`
       track sizes itself to exactly that square width instead of
       splitting evenly with SnrBarChart -- which no longer needs the
       spare width anyway, now that it scrolls horizontally on its own
       (see its own .snrchart CSS) rather than shrinking bars to fit.
       This drops the old auto-fit-driven narrow-viewport stacking
       (both panels always sit side by side now), which is fine: the
       sky-plot's square width never shrinks below its own row height
       regardless of viewport width, and the SNR chart degrades
       gracefully via its own scrollbar rather than needing to stack
       underneath. */
    flex: 0 0 auto;
    height: 260px;
    min-height: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  /* GSA section (see the markup's own comment above for why this is a
     separate, content-sized section rather than a third .satpanels item):
     flex: 0 0 auto, same non-growing convention as .fields/.satpanels
     above it -- .monitorbox is still the only element that grows/scrolls. */
  .gsasection {
    flex: 0 0 auto;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .monitorbox {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    background: var(--zone);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 10px;
    font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink);
  }
  .monitorline {
    white-space: pre;
  }
  .hint {
    color: var(--muted);
    font-style: italic;
  }
  /* Live-rows mode (PLAN.md §10): one row per distinct sentence identity,
     updating in place -- the {#each ... (key)} keyed block above reuses
     the same DOM node per row, so only .liverowline's own {#key row.line}
     inner span is recreated on update (giving the flash below something
     to replay on), not the row itself. */
  .liverow {
    display: flex;
    gap: 10px;
  }
  .liverowkey {
    flex: 0 0 auto;
    min-width: 84px;
    color: var(--muted);
  }
  .liverowline {
    flex: 1 1 auto;
    min-width: 0;
    animation: rowflash 500ms ease-out;
  }
  @keyframes rowflash {
    0% {
      background: var(--accent-bg);
    }
    100% {
      background: transparent;
    }
  }
</style>
