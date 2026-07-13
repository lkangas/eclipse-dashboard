<script lang="ts">
  // Second ribbon under TopBar's main button row, GPS-only (direct
  // request -- "the GPS button should be a toggle for the second
  // ribbon. In that ribbon, there should be buttons: Connect/Connected,
  // Baud dropdown, Freeze, Button for monitor, etc."). Toggled by the
  // plain GPS button in TopBar's row 1 (stores/layout.ts's
  // gpsRibbonExpanded -- a shared store rather than component-local
  // state, since the toggle button and this ribbon are two separately-
  // mounted pieces of markup; see that store's own comment). serial/
  // connection.ts stays the one place that actually talks to
  // navigator.serial; this only drives it and renders gpsConnection.
  //
  // Earlier iteration: this used to be split into a small pill (connect
  // button + a gear icon opening a floating popover) plus this row for
  // status text alone. Consolidated into one flat, always-there-when-
  // expanded row instead -- simpler mental model (one toggle, one
  // panel, nothing floats), and every control that changed width/
  // visibility live (Freeze, status text, the GPS-Δ badge) is what
  // caused the original "top banner is jumpy" complaint; keeping them
  // all in a row that's either fully shown or fully hidden -- never
  // partially reflowing on its own -- means the reflow that does happen
  // here can't touch anything above it.
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
  import { describeFixType, describePort } from '../serial/monitor';
  import { gpsMonitorOpen } from '../stores/layout';

  // Web Serial has no "change baud on an already-open port" call, so the
  // rate still has to be chosen before the click that opens the
  // connection.
  const BAUD_RATES = [4800, 9600, 19200, 38400, 57600, 115200];
  let gpsBaud = $state(115200);

  // Connect/Connected button: reconnects to whatever port worked last
  // time without re-showing Chrome's native device picker, once one
  // exists (direct request -- "now browser wants to choose the port"
  // every time was the complaint). The very first connect in a session,
  // or right after explicitly picking a different port below, still has
  // to go through the picker at least once -- Web Serial has no way
  // around that (a page can't enumerate a device it isn't already
  // granted).
  //
  // 'connecting'/'disconnecting' are a no-op here (bug report: clicking
  // Connect->Disconnect->Connect fast enough gave "the port is already
  // open" -- this button's `disabled` attribute below already covers
  // both busy states so a click shouldn't even reach here, but
  // connection.ts's disconnectGps() is also independently guarded
  // against a redundant call landing anyway -- see its own comment).
  function toggleConnect() {
    const status = $gpsConnection.status;
    if (status === 'connecting' || status === 'disconnecting') return;
    if (status === 'connected') {
      disconnectGps();
    } else if ($gpsConnection.hasRememberedPort) {
      reconnectLastPort(gpsBaud);
    } else {
      connectGps(gpsBaud);
    }
  }

  const connectLabel = $derived.by(() => {
    const s = $gpsConnection.status;
    if (s === 'connecting') return 'Connecting…';
    if (s === 'disconnecting') return 'Disconnecting…';
    if (s === 'connected') return 'Connected';
    return 'Connect';
  });
  const connectTitle = $derived.by(() => {
    const s = $gpsConnection;
    if (s.status === 'error') return s.error;
    if (s.status === 'connecting') return 'Waiting for the port…';
    if (s.status === 'disconnecting') return 'Closing the port…';
    if (s.status === 'connected') return 'Click to disconnect';
    return s.hasRememberedPort ? 'Reconnect to the last GPS port' : 'Connect a USB/serial NMEA GPS receiver';
  });

  // Freeze/Unfreeze: always rendered (disabled rather than unmounted
  // when there's nothing to freeze onto) -- same reasoning as the
  // ribbon-vs-pill consolidation above, so its own presence never
  // reflows the rest of the row.
  function toggleGpsFreeze() {
    if ($gpsConnection.frozen) unfreezeGps();
    else freezeGps();
  }
  const gpsFreezeDisabled = $derived(!$gpsConnection.frozen && !$gpsConnection.fix.hasFix);

  const gpsStatusText = $derived.by(() => {
    const s = $gpsConnection;
    if (s.status === 'error') return s.error;
    if (s.status === 'connecting') return 'Waiting for port…';
    if (s.status === 'disconnecting') return 'Disconnecting…';
    if (s.status !== 'connected') return '';
    if (!s.fix.hasFix) {
      const searching = s.fix.numSatellites !== null ? `No fix (${s.fix.numSatellites} sats)` : 'No fix yet';
      return s.frozen ? `${searching} -- frozen` : searching;
    }
    // Fix type (2D/3D, from GSA) leads the sat/HDOP readout when known --
    // direct request. Not every receiver/config emits GSA, so this is
    // just omitted (not shown as "—") rather than cluttering the line
    // when there's nothing to say.
    const type = s.fix.fixType !== null ? describeFixType(s.fix.fixType) : null;
    const sats = s.fix.numSatellites !== null ? `${s.fix.numSatellites} sats` : 'fix';
    const lead = [type, sats].filter(Boolean).join(', ');
    const hdop = s.fix.hdop !== null ? `, HDOP ${s.fix.hdop.toFixed(1)}` : '';
    const frozen = s.frozen ? ' -- frozen' : '';
    return `Fix: ${lead}${hdop}${frozen}`;
  });
  const gpsStatusIsWarn = $derived(
    $gpsConnection.status === 'error' || ($gpsConnection.status === 'connected' && !$gpsConnection.fix.hasFix),
  );

  // GPS clock discipline (PLAN.md §6) -- effectiveTime (stores/clock.ts)
  // already applies the offset; this just renders it so the offset
  // itself is visible, not only its effect. Signed seconds, one decimal
  // -- sub-second precision is the interesting range here (system clocks
  // are rarely off by whole seconds), anything coarser would hide it.
  function formatClockOffset(ms: number): string {
    const s = ms / 1000;
    return `${s >= 0 ? '+' : ''}${s.toFixed(1)}s`;
  }

  // Port picker: a small popover off the "Port" button -- the one piece
  // of this row still worth keeping as an on-demand overlay rather than
  // always-inline, since the number of previously-granted devices
  // varies and showing them all inline would itself reintroduce
  // width jumpiness into a row built specifically to avoid that.
  let portMenuOpen = $state(false);
  let knownPorts: SerialPort[] = $state([]);
  let portsLoading = $state(false);
  let portMenuEl: HTMLDivElement | undefined = $state();

  async function refreshPorts() {
    portsLoading = true;
    knownPorts = await listKnownPorts();
    portsLoading = false;
  }

  function togglePortMenu() {
    portMenuOpen = !portMenuOpen;
    if (portMenuOpen) void refreshPorts();
  }

  // Web Serial exposes only USB vendor/product ID (see monitor.ts's
  // describePort) -- no device name, no serial number, a deliberate
  // spec-level privacy limit, not something this app can work around.
  // Two granted ports sharing a chipset (e.g. two CP210x-based dongles)
  // would otherwise render as literally identical, unpickable button
  // text -- an ordinal suffix at least makes them distinguishable enough
  // to try one and check the NMEA monitor for whether it's the right one.
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

  async function pickKnownPort(p: SerialPort) {
    portMenuOpen = false;
    await connectToPort(p, gpsBaud);
  }

  async function pickNewPort() {
    portMenuOpen = false;
    await connectGps(gpsBaud);
  }

  // Minimal click-outside-to-close for the port popover specifically
  // (not the ribbon itself -- that's a plain toggle, not a transient
  // overlay, so it doesn't auto-close on an outside click or Escape).
  function onWindowClick(e: MouseEvent) {
    if (portMenuOpen && portMenuEl && !portMenuEl.contains(e.target as Node)) portMenuOpen = false;
  }
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && portMenuOpen) portMenuOpen = false;
  }

  function openMonitor() {
    gpsMonitorOpen.set(true);
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="gpsribbon">
  <button
    class="modebtn"
    class:on={$gpsConnection.status === 'connected'}
    disabled={$gpsConnection.status === 'connecting' || $gpsConnection.status === 'disconnecting'}
    onclick={toggleConnect}
    title={connectTitle}
  >
    {connectLabel}
  </button>
  <select
    class="modebtn baudselect"
    bind:value={gpsBaud}
    disabled={$gpsConnection.status === 'connecting' ||
      $gpsConnection.status === 'connected' ||
      $gpsConnection.status === 'disconnecting'}
    title="Baud rate -- set before connecting"
  >
    {#each BAUD_RATES as rate (rate)}
      <option value={rate}>{rate}</option>
    {/each}
  </select>
  <div class="portwrap" bind:this={portMenuEl}>
    <button class="modebtn" class:on={portMenuOpen} onclick={togglePortMenu} title="Choose which serial port to use">
      Port
    </button>
    {#if portMenuOpen}
      <div class="portmenu">
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
      </div>
    {/if}
  </div>
  <button
    class="modebtn freezebtn"
    class:on={$gpsConnection.frozen}
    disabled={gpsFreezeDisabled}
    onclick={toggleGpsFreeze}
    title={$gpsConnection.frozen ? 'Resume live GPS tracking' : 'Lock the observer to the current GPS fix'}
  >
    {$gpsConnection.frozen ? 'Unfreeze' : 'Freeze'}
  </button>
  <button class="modebtn" onclick={openMonitor} title="Open the fullscreen NMEA stream monitor">
    ⛶ Monitor
  </button>
  {#if gpsStatusText}
    <span class="sourcestatus" class:warn={gpsStatusIsWarn}>{gpsStatusText}</span>
  {/if}
  {#if $gpsConnection.status === 'connected' && $gpsConnection.clockOffsetMs !== null}
    <span
      class="gpsclockbadge"
      title="GPS UTC vs system clock -- the clock in the row above is disciplined to GPS time while connected"
    >
      GPS Δ{formatClockOffset($gpsConnection.clockOffsetMs)}
    </span>
  {/if}
</div>

<style>
  .gpsribbon {
    flex: 0 0 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
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
  .baudselect {
    max-width: 76px;
  }
  .freezebtn {
    min-width: 58px;
  }
  .portwrap {
    position: relative;
  }
  .portmenu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    z-index: 30;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--screen);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
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
  .sourcestatus {
    font-size: 11px;
    color: var(--muted);
  }
  .sourcestatus.warn {
    color: #c22;
  }
  .gpsclockbadge {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    margin-left: auto;
  }
</style>
