<script lang="ts">
  import { observer, setObserver } from '../stores/observer';

  // Dev-only convenience: jumps the lat/lon fields to a preset site. Muted/
  // small on purpose -- the real input is lat/lon + map (PLAN.md §5).
  const SITES: Record<string, { lat: number; lon: number; label: string }> = {
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

  function onSiteChange(e: Event) {
    const site = SITES[(e.currentTarget as HTMLSelectElement).value];
    if (site) setObserver(site.lat, site.lon, 'manual');
  }

  // Local editable strings, not bound directly to the store's formatted
  // value -- typing a decimal point (e.g. "40.") would otherwise get
  // clobbered by toFixed(2) reformatting on every keystroke. Only
  // externally-driven changes (presets, map click/drag) resync the field.
  let latStr = $state($observer.lat.toFixed(2));
  let lonStr = $state($observer.lon.toFixed(2));
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
  $effect(() => {
    const o = $observer;
    if (selfEdit) {
      selfEdit = false;
      return;
    }
    latStr = o.lat.toFixed(2);
    lonStr = o.lon.toFixed(2);
  });

  // Real wall clock -- UT and CEST always shown together (PLAN.md §6).
  // This is the topbar's "now" display, independent of the simulated
  // clock in the time bar.
  let now = $state(new Date());
  $effect(() => {
    const id = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(id);
  });
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
  <select class="siteselect" onchange={onSiteChange}>
    <option value="" selected disabled>Presets</option>
    {#each Object.entries(SITES) as [key, site] (key)}
      <option value={key}>{site.label}</option>
    {/each}
  </select>
  <input
    type="number"
    class="coordinput"
    step="0.01"
    bind:value={latStr}
    oninput={onLatInput}
  />
  <input
    type="number"
    class="coordinput"
    step="0.01"
    bind:value={lonStr}
    oninput={onLonInput}
  />
  <button class="geobtn" title="Use device location">⌖</button>
  <span class="fill"></span>
  <span>{cestFmt.format(now)} CEST</span>
  <span>{utFmt.format(now)} UT</span>
</div>

<style>
  .topbar {
    flex: 0 0 34px;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 14px;
    font-size: 13px;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
  }
  .topbar .fill {
    flex: 1;
  }
  .siteselect {
    font: inherit;
    font-size: 12px;
    color: var(--muted);
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }
  .siteselect:hover {
    color: var(--ink);
  }
  .coordinput {
    font: inherit;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    background: none;
    border: none;
    border-bottom: 1px solid var(--line);
    padding: 1px 2px;
    width: 52px;
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .coordinput:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .coordinput::-webkit-inner-spin-button,
  .coordinput::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .geobtn {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .geobtn:hover {
    border-color: var(--muted);
  }
</style>
