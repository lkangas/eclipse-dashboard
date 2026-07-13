<script lang="ts">
  // GPS pill: connect/disconnect + freeze, and a gear-icon popover for
  // port/baud configuration plus a live raw-NMEA-stream monitor (direct
  // request -- split out of TopBar.svelte once the port-picker/monitor
  // UI grew past "one button and one select"). serial/connection.ts
  // stays the one place that actually talks to navigator.serial; this
  // only drives it and renders gpsConnection.
  import {
    gpsConnection,
    connectGps,
    disconnectGps,
    freezeGps,
    unfreezeGps,
    reconnectLastPort,
    connectToPort,
    listKnownPorts,
    isActivePort,
  } from '../serial/connection';
  import { describePort } from '../serial/monitor';
  import { observer } from '../stores/observer';

  // Web Serial has no "change baud on an already-open port" call, so the
  // rate still has to be chosen before the click that opens the
  // connection -- same constraint TopBar's own baud select used to
  // carry, just relocated into the gear popover now.
  const BAUD_RATES = [4800, 9600, 19200, 38400, 57600, 115200];
  let gpsBaud = $state(9600);

  // Main pill button: reconnects to whatever port worked last time
  // without re-showing Chrome's native device picker, once one exists
  // (direct request -- "now browser wants to choose the port" every
  // time was the complaint). The very first connect in a session, or
  // right after explicitly picking "Choose a port..." below, still has
  // to go through the picker at least once -- Web Serial has no way
  // around that (a page can't enumerate a device it isn't already
  // granted).
  function toggleGps() {
    if ($gpsConnection.status === 'connected' || $gpsConnection.status === 'connecting') {
      disconnectGps();
    } else if ($gpsConnection.hasRememberedPort) {
      reconnectLastPort(gpsBaud);
    } else {
      connectGps(gpsBaud);
    }
  }

  const gpsButtonLabel = $derived($gpsConnection.status === 'connecting' ? 'Connecting…' : 'GPS');
  const gpsButtonTitle = $derived.by(() => {
    const s = $gpsConnection;
    if (s.status === 'error') return s.error;
    if (s.status === 'connecting') return 'Waiting for the port…';
    if (s.status === 'connected') return 'Click to disconnect';
    return s.hasRememberedPort ? 'Reconnect to the last GPS port' : 'Connect a USB/serial NMEA GPS receiver';
  });
  // Separate from the button's own title/tooltip (which only a hover
  // reveals) -- an always-visible line, since fix quality is worth
  // seeing at a glance while connected rather than only on request.
  const gpsStatusText = $derived.by(() => {
    const s = $gpsConnection;
    if (s.status === 'error') return s.error;
    if (s.status === 'connecting') return 'Waiting for port…';
    if (s.status !== 'connected') return '';
    if (!s.fix.hasFix) {
      const searching = s.fix.numSatellites !== null ? `No fix (${s.fix.numSatellites} sats)` : 'No fix yet';
      return s.frozen ? `${searching} -- frozen` : searching;
    }
    const sats = s.fix.numSatellites !== null ? `${s.fix.numSatellites} sats` : 'fix';
    const hdop = s.fix.hdop !== null ? `, HDOP ${s.fix.hdop.toFixed(1)}` : '';
    const frozen = s.frozen ? ' -- frozen' : '';
    return `Fix: ${sats}${hdop}${frozen}`;
  });
  const gpsStatusIsWarn = $derived(
    $gpsConnection.status === 'error' || ($gpsConnection.status === 'connected' && !$gpsConnection.fix.hasFix),
  );

  // Freeze (direct request): lock the observer marker to whatever fix is
  // current, since even a "good" fix can still jitter a few meters
  // report to report -- see freezeGps()'s own comment. Manual only, no
  // auto-freeze on first fix. Enabled once there's a fix to freeze onto,
  // OR while already frozen (so it can always be toggled back off).
  function toggleGpsFreeze() {
    if ($gpsConnection.frozen) unfreezeGps();
    else freezeGps();
  }
  const gpsFreezeDisabled = $derived(!$gpsConnection.frozen && !$gpsConnection.fix.hasFix);

  // Gear popover: port list (previously-granted devices only -- Web
  // Serial never lists ungranted ones, see connection.ts's
  // listKnownPorts) + baud + the raw NMEA monitor. Ports are refreshed
  // on open/on request rather than kept live -- this is a debug/config
  // panel, not something that needs to react to a device being plugged
  // in while already open.
  let gearOpen = $state(false);
  let knownPorts: SerialPort[] = $state([]);
  let portsLoading = $state(false);
  let panelEl: HTMLDivElement | undefined = $state();

  async function refreshPorts() {
    portsLoading = true;
    knownPorts = await listKnownPorts();
    portsLoading = false;
  }

  // Web Serial exposes only USB vendor/product ID (see monitor.ts's
  // describePort) -- no device name, no serial number, a deliberate
  // spec-level privacy limit, not something this app can work around.
  // Two granted ports sharing a chipset (e.g. two CP210x-based dongles)
  // would otherwise render as literally identical, unpickable button
  // text -- an ordinal suffix at least makes them distinguishable enough
  // to try one and check the NMEA monitor below for whether it's the
  // right one.
  const portLabels = $derived.by(() => {
    const raw = knownPorts.map(describePort);
    const seenSoFar = new Map<string, number>();
    const totalOf = new Map<string, number>();
    for (const label of raw) totalOf.set(label, (totalOf.get(label) ?? 0) + 1);
    return raw.map((label) => {
      const ordinal = (seenSoFar.get(label) ?? 0) + 1;
      seenSoFar.set(label, ordinal);
      return (totalOf.get(label) ?? 0) > 1 ? `${label} #${ordinal}` : label;
    });
  });

  function toggleGear() {
    gearOpen = !gearOpen;
    if (gearOpen) {
      // Every fresh open starts pinned to the newest line, regardless of
      // where a previous session left the scroll position (the DOM node
      // itself is destroyed/recreated by the {#if gearOpen} block below,
      // so scrollTop wouldn't have persisted anyway).
      stickToBottom = true;
      void refreshPorts();
    }
  }

  async function pickKnownPort(p: SerialPort) {
    gearOpen = false;
    await connectToPort(p, gpsBaud);
  }

  async function pickNewPort() {
    gearOpen = false;
    await connectGps(gpsBaud);
  }

  // Minimal click-outside-to-close -- no existing popover pattern
  // elsewhere in this app to match, so kept as simple as it can be:
  // close on any window click outside the pill/dropdown, or Escape.
  function onWindowClick(e: MouseEvent) {
    if (gearOpen && panelEl && !panelEl.contains(e.target as Node)) gearOpen = false;
  }
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && gearOpen) gearOpen = false;
  }

  // Auto-scrolls the monitor to the newest line -- only while the
  // popover is actually open (a connection accumulating lines in the
  // background does no pointless scroll-container work while hidden),
  // AND only while the user hasn't scrolled up to read something (bug
  // report: at up to 10Hz this used to fight a manual scroll-up and snap
  // straight back to the bottom on the very next line, making it
  // impossible to actually read the history this monitor exists to
  // show). Standard "tail -f" convention: stick to the bottom until the
  // user deliberately leaves it, then stop following until they scroll
  // back down themselves.
  let monitorEl: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);

  function onMonitorScroll() {
    if (!monitorEl) return;
    const distanceFromBottom = monitorEl.scrollHeight - monitorEl.scrollTop - monitorEl.clientHeight;
    stickToBottom = distanceFromBottom < 24;
  }

  $effect(() => {
    const lineCount = $gpsConnection.recentLines.length;
    if (gearOpen && monitorEl && stickToBottom) {
      void lineCount; // establishes the reactive dependency
      monitorEl.scrollTop = monitorEl.scrollHeight;
    }
  });
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="gpspill" bind:this={panelEl}>
  <button
    class="modebtn"
    class:on={$observer.source === 'gps'}
    disabled={$gpsConnection.status === 'connecting'}
    onclick={toggleGps}
    title={gpsButtonTitle}
  >
    {gpsButtonLabel}
  </button>
  {#if $gpsConnection.status === 'connected'}
    <button
      class="modebtn freezebtn"
      class:on={$gpsConnection.frozen}
      disabled={gpsFreezeDisabled}
      onclick={toggleGpsFreeze}
      title={$gpsConnection.frozen ? 'Resume live GPS tracking' : 'Lock the observer to the current GPS fix'}
    >
      {$gpsConnection.frozen ? 'Unfreeze' : 'Freeze'}
    </button>
  {/if}
  <button
    class="modebtn gearbtn"
    class:on={gearOpen}
    onclick={toggleGear}
    title="GPS port &amp; baud, NMEA monitor"
    aria-label="GPS settings"
  >
    ⚙
  </button>
  {#if gpsStatusText}
    <span class="sourcestatus" class:warn={gpsStatusIsWarn}>{gpsStatusText}</span>
  {/if}

  {#if gearOpen}
    <div class="gpsdropdown">
      <div class="dropdownrow">
        <label for="gpsbaud">Baud</label>
        <select
          id="gpsbaud"
          class="modebtn baudselect"
          bind:value={gpsBaud}
          disabled={$gpsConnection.status === 'connecting' || $gpsConnection.status === 'connected'}
        >
          {#each BAUD_RATES as rate (rate)}
            <option value={rate}>{rate}</option>
          {/each}
        </select>
      </div>
      <div class="dropdownrow">
        <span class="dropdownlabel">Port</span>
        <button class="refreshbtn" onclick={refreshPorts} title="Re-scan previously granted ports">⟳ refresh</button>
      </div>
      {#if portsLoading}
        <div class="hint">Loading…</div>
      {:else if knownPorts.length === 0}
        <div class="hint">No previously granted ports yet -- use "Choose a port…" below.</div>
      {:else}
        {#each knownPorts as p, i (i)}
          {@const active = $gpsConnection.status === 'connected' && isActivePort(p)}
          <button class="portoption" class:on={active} disabled={active} onclick={() => pickKnownPort(p)}>
            {portLabels[i]}{active ? ' (connected)' : ''}
          </button>
        {/each}
      {/if}
      <button class="portoption newport" onclick={pickNewPort}>Choose a port…</button>

      <div class="dropdownrow monitorhead">
        <span class="dropdownlabel">NMEA stream</span>
      </div>
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
</div>

<style>
  /* Same shared toggle-group visual language as TopBar's own .modebtn
     (and MapPanel's .zoomtoggle / ContactsPanel's .globaltoggle) --
     Svelte's per-component CSS scoping means it has to be redeclared
     here rather than inherited, same convention those already follow. */
  .gpspill {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .modebtn {
    font: inherit;
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    cursor: pointer;
  }
  .modebtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .modebtn.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
  }
  .freezebtn {
    min-width: 58px;
  }
  .gearbtn {
    padding: 3px 6px;
    font-size: 12px;
    line-height: 1;
  }
  .sourcestatus {
    font-size: 11px;
    color: var(--muted);
  }
  .sourcestatus.warn {
    color: #c22;
  }
  .gpsdropdown {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    z-index: 30;
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--screen);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }
  .dropdownrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 11px;
  }
  .dropdownrow label {
    color: var(--muted);
  }
  .dropdownlabel {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .baudselect {
    max-width: 90px;
  }
  .refreshbtn {
    font: inherit;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 11px;
    padding: 0 2px;
  }
  .portoption {
    font: inherit;
    text-align: left;
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 6px;
    font-size: 11px;
    color: var(--ink);
    cursor: pointer;
  }
  .portoption.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
    cursor: default;
  }
  .portoption.newport {
    color: var(--muted);
    border-style: dashed;
  }
  .hint {
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
  }
  .monitorhead {
    margin-top: 2px;
  }
  .monitorbox {
    height: 120px;
    overflow-y: auto;
    background: var(--zone);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 6px;
    font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
    font-size: 10px;
    line-height: 1.4;
    color: var(--ink);
  }
  .monitorline {
    white-space: pre;
    overflow-x: hidden;
    text-overflow: ellipsis;
  }
</style>
