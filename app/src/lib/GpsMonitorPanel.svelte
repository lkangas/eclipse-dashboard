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
  import { describeFixQuality, describeFixType } from '../serial/monitor';

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
  // down themselves.
  let monitorEl: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);
  function onMonitorScroll() {
    if (!monitorEl) return;
    const distanceFromBottom = monitorEl.scrollHeight - monitorEl.scrollTop - monitorEl.clientHeight;
    stickToBottom = distanceFromBottom < 24;
  }
  $effect(() => {
    const lineCount = $gpsConnection.recentLines.length;
    if ($gpsMonitorOpen && monitorEl && stickToBottom) {
      void lineCount; // establishes the reactive dependency
      monitorEl.scrollTop = monitorEl.scrollHeight;
    }
  });
  // Every fresh open starts pinned to the newest line -- the DOM node is
  // destroyed/recreated by the {#if $gpsMonitorOpen} block below, so
  // scrollTop wouldn't have persisted from a previous open anyway.
  $effect(() => {
    if ($gpsMonitorOpen) stickToBottom = true;
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

    <div class="streamhead">Raw NMEA stream</div>
    <div class="monitorbox" bind:this={monitorEl} onscroll={onMonitorScroll}>
      {#each $gpsConnection.recentLines as line, i (i)}
        <div class="monitorline">{line}</div>
      {/each}
      {#if $gpsConnection.recentLines.length === 0}
        <div class="monitorline hint">No data yet.</div>
      {/if}
    </div>
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
</style>
