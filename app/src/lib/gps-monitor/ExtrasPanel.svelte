<script lang="ts">
  // GPS-MONITOR-PLAN.md §6 phase 3: the cheap once-per-epoch panels --
  // VTG, GLL, ZDA, HDG, GNS, and the RMC-extras fields nmea.ts's own
  // minimal RmcSentence doesn't carry (§2's "Corrections from an actual
  // screenshot": "add to Phase 3's RMC-extras scope"). No props --
  // subscribes to gpsExtras directly, same convention as GsaPanel/
  // SatelliteSkyPlot/SnrBarChart (see their own file-level comments).
  // Unlike GsaPanel (a variable number of cards, one per constellation),
  // there are always at most 6 cards here, one per sentence type -- each
  // rendered only once that type's first sentence has arrived, same
  // progressive-reveal philosophy, just keyed by TYPE instead of by
  // constellation.
  //
  // Field-value markup mirrors GsaPanel.svelte's own .panel/.fields/
  // .field convention (copied into this component's own style block --
  // Svelte scoped styles don't cascade between sibling components).
  import { gpsExtras } from '../../stores/gpsExtras';
  import {
    describeGnsModeIndicator,
    describeModeIndicator,
    describeNavStatus,
    describeValidity,
  } from '../../serial/monitor';
  import type { RichTimeOfDay } from '../../serial/nmeaRich';

  function pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  function timeText(t: RichTimeOfDay | null): string {
    if (t === null) return '—';
    return `${pad2(t.hours)}:${pad2(t.minutes)}:${pad2(Math.trunc(t.seconds))}`;
  }

  function degText(v: number | null): string {
    return v !== null ? `${v.toFixed(1)}°` : '—';
  }

  function knotsText(v: number | null): string {
    return v !== null ? `${v.toFixed(1)} kn` : '—';
  }

  function latLonText(v: number | null): string {
    return v !== null ? v.toFixed(6) : '—';
  }

  const vtg = $derived($gpsExtras.vtg);
  const gll = $derived($gpsExtras.gll);
  const zda = $derived($gpsExtras.zda);
  const hdg = $derived($gpsExtras.hdg);
  const gns = $derived($gpsExtras.gns);
  const rmc = $derived($gpsExtras.rmcExtras);

  const zdaDateText = $derived(
    zda && zda.year !== null && zda.month !== null && zda.day !== null
      ? `${zda.year}/${pad2(zda.month)}/${pad2(zda.day)}`
      : '—',
  );
  const zdaZoneText = $derived(
    zda && zda.zoneHours !== null
      ? `${zda.zoneHours >= 0 ? '+' : ''}${zda.zoneHours}:${pad2(zda.zoneMinutes ?? 0)}`
      : '—',
  );

  function devVarText(deg: number | null, dir: 'E' | 'W' | null): string {
    if (deg === null) return '—';
    return dir !== null ? `${deg.toFixed(1)}°${dir}` : `${deg.toFixed(1)}°`;
  }

  const noData = $derived(!vtg && !gll && !zda && !hdg && !gns && !rmc);
</script>

<div class="extraspanels">
  {#if noData}
    <div class="hint">No VTG/GLL/ZDA/HDG/GNS data yet.</div>
  {:else}
    {#if rmc}
      <div class="panel">
        <div class="panelheader">RMC extras</div>
        <div class="fields">
          <div class="field"><span>Speed</span><b>{knotsText(rmc.speedKnots)}</b></div>
          <div class="field"><span>Course</span><b>{degText(rmc.courseDeg)}</b></div>
          <div class="field"><span>Mag var</span><b>{devVarText(rmc.magVariationDeg, rmc.magVariationDir)}</b></div>
          <div class="field"><span>Mode</span><b>{describeModeIndicator(rmc.mode)}</b></div>
          <div class="field"><span>Nav sta.</span><b>{describeNavStatus(rmc.navStatus)}</b></div>
        </div>
      </div>
    {/if}
    {#if vtg}
      <div class="panel">
        <div class="panelheader">VTG</div>
        <div class="fields">
          <div class="field"><span>Course/T</span><b>{degText(vtg.courseTrueDeg)}</b></div>
          <div class="field"><span>Course/M</span><b>{degText(vtg.courseMagDeg)}</b></div>
          <div class="field"><span>Spd (kn)</span><b>{knotsText(vtg.speedKnots)}</b></div>
          <div class="field"><span>Spd (km/h)</span><b>{vtg.speedKmh !== null ? `${vtg.speedKmh.toFixed(1)} km/h` : '—'}</b></div>
          <div class="field"><span>Mode</span><b>{describeModeIndicator(vtg.mode)}</b></div>
        </div>
      </div>
    {/if}
    {#if gll}
      <div class="panel">
        <div class="panelheader">GLL</div>
        <div class="fields">
          <div class="field"><span>Lat</span><b>{latLonText(gll.lat)}</b></div>
          <div class="field"><span>Lon</span><b>{latLonText(gll.lon)}</b></div>
          <div class="field"><span>UTC</span><b>{timeText(gll.timeOfDay)}</b></div>
          <div class="field"><span>Status</span><b>{describeValidity(gll.status)}</b></div>
          <div class="field"><span>Mode</span><b>{describeModeIndicator(gll.mode)}</b></div>
        </div>
      </div>
    {/if}
    {#if zda}
      <div class="panel">
        <div class="panelheader">ZDA</div>
        <div class="fields">
          <div class="field"><span>UTC</span><b>{timeText(zda.timeOfDay)}</b></div>
          <div class="field"><span>Date</span><b>{zdaDateText}</b></div>
          <div class="field"><span>Zone</span><b>{zdaZoneText}</b></div>
        </div>
      </div>
    {/if}
    {#if hdg}
      <div class="panel">
        <div class="panelheader">HDG</div>
        <div class="fields">
          <div class="field"><span>Heading</span><b>{degText(hdg.headingDeg)}</b></div>
          <div class="field"><span>Deviation</span><b>{devVarText(hdg.deviationDeg, hdg.deviationDir)}</b></div>
          <div class="field"><span>Variation</span><b>{devVarText(hdg.variationDeg, hdg.variationDir)}</b></div>
        </div>
      </div>
    {/if}
    {#if gns}
      <div class="panel">
        <div class="panelheader">GNS</div>
        <div class="fields">
          <div class="field"><span>UTC</span><b>{timeText(gns.timeOfDay)}</b></div>
          <div class="field"><span>Lat</span><b>{latLonText(gns.lat)}</b></div>
          <div class="field"><span>Lon</span><b>{latLonText(gns.lon)}</b></div>
          <div class="field"><span>Sats</span><b>{gns.numSatellites ?? '—'}</b></div>
          <div class="field"><span>HDOP</span><b>{gns.hdop !== null ? gns.hdop.toFixed(1) : '—'}</b></div>
          <div class="field"><span>Altitude</span><b>{gns.altitudeM !== null ? `${gns.altitudeM.toFixed(1)} m` : '—'}</b></div>
          <div class="field"><span>Geoid sep</span><b>{gns.geoidSepM !== null ? `${gns.geoidSepM.toFixed(1)} m` : '—'}</b></div>
          <div class="field"><span>Nav sta.</span><b>{describeNavStatus(gns.navStatus)}</b></div>
          <div class="field modefield"><span>Mode</span><b>{describeGnsModeIndicator(gns.modeIndicator)}</b></div>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .extraspanels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }
  .hint {
    color: var(--muted);
    font-style: italic;
    font-size: 13px;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .panelheader {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
    gap: 8px 14px;
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
  /* GNS's mode-indicator text ("Autonomous / Autonomous / No fix") can run
     long -- give it the full card width rather than squeezing it into one
     grid cell, same reasoning as GsaPanel's own .usedfield. */
  .modefield {
    grid-column: 1 / -1;
  }
  .modefield b {
    font-size: 13px;
  }
</style>
