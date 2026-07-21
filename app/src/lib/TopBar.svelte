<script lang="ts">
  import { observer, setObserver, setObserverElevation } from '../stores/observer';
  import { clock, effectiveTime } from '../stores/clock';
  import { gpsConnection, disconnectGps } from '../serial/connection';
  import { gpsRibbonExpanded } from '../stores/layout';
  import GpsRibbon from './GpsRibbon.svelte';
  import SoundControl from './SoundControl.svelte';

  // Switching to a different position source must actually release the
  // GPS serial connection, not just change observer.source (bug report:
  // leaving GPS connected in the background after picking Browser/
  // Manual/a preset left the port open, which then errored on a later
  // reconnect attempt -- e.g. from another tool trying to open the same
  // port). Guards on status !== 'idle' rather than just 'connected' so a
  // stuck 'connecting'/'error' state is cleaned up too, not just a live
  // connection.
  function leaveGps() {
    if ($gpsConnection.status !== 'idle') disconnectGps();
  }

  // Location-mode toggle group (direct request): GPS / Browser / Manual
  // (map) / a named preset, one active at a time -- observer.source IS
  // this mode (stores/observer.ts). GPS (serial NMEA) is real; the button
  // below is deliberately just a show/hide toggle for GpsRibbon.svelte
  // (the second row, direct request -- "the GPS button should be a
  // toggle for the second ribbon"), which is where connect/disconnect,
  // baud, port, and Freeze actually live. Browser (navigator.geolocation,
  // see useBrowserLocation below) is also real. Calamocha (this project's
  // fixed default site) is included as a preset alongside the others,
  // and is the actual default source until one of GPS/Browser is used.
  const SITES: Record<string, { lat: number; lon: number; label: string }> = {
    calamocha: { lat: 40.92, lon: -1.3, label: 'Calamocha' },
    acoruna: { lat: 43.36, lon: -8.41, label: 'A Coruña' },
    oviedo: { lat: 43.36, lon: -5.85, label: 'Oviedo / Gijón' },
    leon: { lat: 42.6, lon: -5.57, label: 'León' },
    burgos: { lat: 42.34, lon: -3.7, label: 'Burgos' },
    santander: { lat: 43.46, lon: -3.81, label: 'Santander' },
    bilbao: { lat: 43.26, lon: -2.94, label: 'Bilbao' },
    zaragoza: { lat: 41.65, lon: -0.89, label: 'Zaragoza' },
    valencia: { lat: 39.47, lon: -0.38, label: 'Valencia' },
    castellon: { lat: 40.36, lon: 0.4, label: 'Castellón / Peñíscola' },
    palma: { lat: 39.57, lon: 2.65, label: 'Palma de Mallorca' },
  };

  // Remembers the last-picked preset even while a *different* mode
  // (Manual) is active, so the dropdown's own label stays put at rest
  // and clicking back into it returns to the same place rather than
  // some reset default.
  let selectedPresetKey = $state('calamocha');

  // Only an actual selection in the list changes the location (direct
  // request/bug report) -- merely opening/clicking the dropdown while
  // Manual is active must NOT switch away from Manual by itself. An
  // earlier version also reacted on mousedown/focus (to make returning
  // to the SAME already-remembered preset possible, since a native
  // <select> doesn't fire `change` on a no-op reselect) -- reverted:
  // that made every click on the closed dropdown prematurely change the
  // active location, which is worse than the edge case it was solving.
  function onPresetChange(e: Event) {
    const key = (e.currentTarget as HTMLSelectElement).value;
    const site = SITES[key];
    if (!site) return;
    selectedPresetKey = key;
    browserStatus = 'idle';
    browserError = '';
    leaveGps();
    setObserver(site.lat, site.lon, 'preset');
  }

  // Switching TO Manual doesn't change lat/lon/elevation at all -- just
  // flips into editable/map-draggable mode, showing whatever was
  // already active (direct request).
  function selectManual() {
    browserStatus = 'idle';
    browserError = '';
    leaveGps();
    setObserver($observer.lat, $observer.lon, 'manual');
  }
  const isManual = $derived($observer.source === 'manual');

  // Browser geolocation (PLAN.md §5): navigator.geolocation needs a secure
  // context -- HTTPS or localhost, NOT file:// or plain http://<ip> -- so
  // that's checked up front and surfaced as a clear message rather than
  // left to silently fail/never prompt. A transient status (locating/
  // error) rather than folding into observer.source alone, since an error
  // must stay visible without pretending the mode switched.
  let browserStatus: 'idle' | 'locating' | 'error' = $state('idle');
  let browserError = $state('');

  function useBrowserLocation() {
    browserError = '';
    if (!window.isSecureContext || !navigator.geolocation) {
      browserStatus = 'error';
      browserError = 'Needs HTTPS or localhost';
      return;
    }
    leaveGps();
    browserStatus = 'locating';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        browserStatus = 'idle';
        setObserver(pos.coords.latitude, pos.coords.longitude, 'browser');
      },
      (err) => {
        browserStatus = 'error';
        browserError =
          err.code === err.PERMISSION_DENIED
            ? 'Permission denied'
            : err.code === err.TIMEOUT
              ? 'Timed out'
              : 'Location unavailable';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  // Local editable strings, not bound directly to the store's formatted
  // value -- typing a decimal point (e.g. "40.") would otherwise get
  // clobbered by toFixed(2) reformatting on every keystroke. Only
  // externally-driven changes (presets, map click/drag) resync the
  // fields. One shared flag across all three is fine (not per-field):
  // each setter only ever touches its own value (lat/lon or elevation),
  // so skipping a resync of the untouched fields in the same tick is a
  // no-op anyway.
  // 4 decimals always (direct request -- "enough precision to encourage
  // manual coordinate entry"), and always a '.' regardless of OS/browser
  // locale: toFixed()/parseFloat() are both locale-independent already
  // (unlike a plain <input type="number">, which some browsers render
  // and parse using the OS locale's own decimal separator -- a comma-
  // locale user could see/need a comma there instead). Using
  // type="text" + inputmode="decimal" below rather than type="number"
  // sidesteps that entirely: the displayed/expected format is always
  // this component's own toFixed(4)/parseFloat, never the browser's.
  const COORD_DECIMALS = 4;
  let latStr = $state($observer.lat.toFixed(COORD_DECIMALS));
  let lonStr = $state($observer.lon.toFixed(COORD_DECIMALS));
  let elevStr = $state(Math.round($observer.elevationM).toString());
  let selfEdit = false;

  function onLatInput() {
    const lat = parseFloat(latStr);
    if (Number.isNaN(lat)) return;
    selfEdit = true;
    setObserver(lat, $observer.lon, 'manual');
  }
  function onLonInput() {
    const lon = parseFloat(lonStr);
    if (Number.isNaN(lon)) return;
    selfEdit = true;
    setObserver($observer.lat, lon, 'manual');
  }
  // Direct elevation override -- setObserverElevation() bypasses the DEM
  // lookup without touching lat/lon (see its own comment in
  // stores/observer.ts); any subsequent lat/lon change resets it back to
  // the real DEM value, same as every other setObserver() caller.
  function onElevInput() {
    const m = parseFloat(elevStr);
    if (Number.isNaN(m)) return;
    selfEdit = true;
    setObserverElevation(m);
  }
  $effect(() => {
    const o = $observer;
    if (selfEdit) {
      selfEdit = false;
      return;
    }
    latStr = o.lat.toFixed(COORD_DECIMALS);
    lonStr = o.lon.toFixed(COORD_DECIMALS);
    elevStr = Math.round(o.elevationM).toString();
  });

  // UT and CEST always shown together (PLAN.md §6), tracking whatever
  // instant is actually driving the rest of the app -- effectiveTime,
  // not the real wall clock unconditionally. In sim mode this must show
  // the simulated instant (and a Sim badge), otherwise the topbar clock
  // visibly disagrees with every other panel while dragging/playing the
  // time bar.
  const utFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const cestFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
</script>

<div class="topbar">
  <div class="modegroup">
    <button
      class="modebtn"
      class:on={$observer.source === 'gps'}
      onclick={() => gpsRibbonExpanded.update((v) => !v)}
      title={$gpsRibbonExpanded ? 'Hide GPS controls' : 'Show GPS controls'}
    >
      GPS {$gpsRibbonExpanded ? '▴' : '▾'}
    </button>
    <button
      class="modebtn"
      class:on={$observer.source === 'browser'}
      disabled={browserStatus === 'locating'}
      onclick={useBrowserLocation}
      title={browserStatus === 'error' ? browserError : 'Use this browser/device location'}
    >
      {browserStatus === 'locating' ? 'Locating…' : 'Browser'}
    </button>
    <button class="modebtn" class:on={isManual} onclick={selectManual}>Manual (map)</button>
    <select
      class="modebtn presetbtn"
      class:on={$observer.source === 'preset'}
      value={selectedPresetKey}
      onchange={onPresetChange}
    >
      {#each Object.entries(SITES) as [key, site] (key)}
        <option value={key}>{site.label}</option>
      {/each}
    </select>
    {#if browserStatus === 'error'}
      <span class="sourcestatus warn">{browserError}</span>
    {/if}
  </div>
  <SoundControl />
  <input
    type="text"
    inputmode="decimal"
    class="coordinput"
    bind:value={latStr}
    oninput={onLatInput}
    disabled={!isManual}
  />
  <input
    type="text"
    inputmode="decimal"
    class="coordinput"
    bind:value={lonStr}
    oninput={onLonInput}
    disabled={!isManual}
  />
  <div class="elevwrap" title="Ground elevation above sea level (offline DEM lookup)">
    {#if $observer.elevationOutOfBounds && !$observer.elevationManuallySet}
      <span
        class="elevwarn"
        title="No elevation data here -- outside the bundled Spain / W. Mediterranean terrain grid. Defaulted to 0; enter the real figure if you know it."
        >⚠</span
      >
    {/if}
    <input
      type="number"
      class="coordinput elevinput"
      step="1"
      bind:value={elevStr}
      oninput={onElevInput}
      disabled={!isManual && !$observer.elevationOutOfBounds}
    />
    <span class="unit">m</span>
  </div>
  <span class="fill"></span>
  {#if $clock.mode === 'sim'}
    <span class="simbadge">Sim</span>
  {/if}
  <span class="clocktext">{cestFmt.format($effectiveTime)} CEST</span>
  <span class="clocktext">{utFmt.format($effectiveTime)} UT</span>
</div>
{#if $gpsRibbonExpanded}
  <GpsRibbon />
{/if}

<style>
  .topbar {
    flex: 0 0 34px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    font-size: 13px;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
  }
  .topbar .fill {
    flex: 1;
  }
  .modegroup {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sourcestatus {
    font-size: 11px;
    color: var(--muted);
  }
  .sourcestatus.warn {
    color: #c22;
  }
  /* Shared toggle-group visual language (same convention as MapPanel's
     .zoomtoggle / ContactsPanel's .globaltoggle) -- <button> and
     <select> both styled identically so the row reads as one group. */
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
  .presetbtn {
    max-width: 120px;
  }
  .coordinput {
    font: inherit;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    background: var(--screen);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 3px 6px;
    /* Wide enough for the worst case at 4 decimals, e.g. "-180.0000"
       (longitude) -- was 56px, sized for the old 2-decimal format. */
    width: 76px;
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .coordinput:focus {
    outline: none;
    border-color: var(--accent);
  }
  .coordinput:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .coordinput::-webkit-inner-spin-button,
  .coordinput::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .elevwrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .elevinput {
    width: 50px;
  }
  .elevwarn {
    color: #c22;
    font-size: 12px;
    cursor: help;
  }
  .unit {
    color: var(--muted);
  }
  .simbadge {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--accent-ink);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 1px 5px;
  }
  /* "A bit bigger and bold" (direct request) -- was the same 13px/
     regular-weight as everything else in the bar. */
  .clocktext {
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
