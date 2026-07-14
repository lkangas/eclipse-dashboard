<script lang="ts">
  // GPS-MONITOR-PLAN.md §6 phase 2 / §2's "two GNGSA panels side by side"
  // reference idea, generalized: one small panel PER constellation
  // currently reporting a full-GSA sentence (gpsSatellites.gsaByKey),
  // not a hardcoded GPS+Galileo pair -- however many constellations show
  // up there, that's how many panels render. No props -- subscribes to
  // gpsSatellites directly, same convention as its SatelliteSkyPlot/
  // SnrBarChart siblings (see their own file-level comments).
  //
  // Field values reuse monitor.ts's existing human-label helpers
  // (describeSystemId/describeConstellation/describeFixType) rather than
  // inventing new label logic here, and the per-field markup below mirrors
  // GpsMonitorPanel.svelte's own .field/.fields label-above-value
  // convention (copied into this component's own style block, since
  // Svelte scoped styles don't cascade from one component into another).
  import { gpsSatellites } from '../../stores/gpsSatellites';
  import { describeConstellation, describeFixType, describeSystemId } from '../../serial/monitor';

  interface GsaPanelEntry {
    key: string;
    label: string;
    fixTypeText: string;
    pdopText: string;
    hdopText: string;
    vdopText: string;
    usedText: string;
  }

  function dopText(value: number | null): string {
    return value !== null ? value.toFixed(1) : '—';
  }

  // Sorted by key (not object insertion order, which isn't guaranteed
  // stable as gsaByKey gets upserted) so panels don't reshuffle position
  // between renders as constellations report in.
  const entries: GsaPanelEntry[] = $derived(
    Object.values($gpsSatellites.gsaByKey)
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((info) => ({
        key: info.key,
        label: info.systemId !== null ? describeSystemId(info.systemId) : describeConstellation(info.talkerId),
        fixTypeText: describeFixType(info.fixType),
        pdopText: dopText(info.pdop),
        hdopText: dopText(info.hdop),
        vdopText: dopText(info.vdop),
        usedText: info.usedPrns.length > 0 ? info.usedPrns.join(', ') : '—',
      })),
  );
  const noData = $derived(entries.length === 0);
</script>

<div class="gsapanels">
  {#if noData}
    <div class="hint">No GSA data yet.</div>
  {:else}
    {#each entries as entry (entry.key)}
      <div class="panel">
        <div class="panelheader">{entry.label}</div>
        <div class="fields">
          <div class="field"><span>Fix type</span><b>{entry.fixTypeText}</b></div>
          <div class="field"><span>PDOP</span><b>{entry.pdopText}</b></div>
          <div class="field"><span>HDOP</span><b>{entry.hdopText}</b></div>
          <div class="field"><span>VDOP</span><b>{entry.vdopText}</b></div>
          <div class="field usedfield"><span>Used</span><b>{entry.usedText}</b></div>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .gsapanels {
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
  /* Same label-above-value convention as GpsMonitorPanel.svelte's own
     .field/.fields (copied here rather than shared -- see this file's
     header comment on why a Svelte component can't inherit a sibling's
     scoped styles), just a tighter minmax than that panel's top-level
     .fields grid since each GSA card here is itself already small. */
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
  /* The used-PRN list can be a long comma-joined string -- give it the
     full panel width rather than squeezing it into one grid cell. */
  .usedfield {
    grid-column: 1 / -1;
  }
  .usedfield b {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    word-break: break-word;
  }
</style>
