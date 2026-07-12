<script lang="ts">
  // Shown only while a panel is fullscreen (App.svelte). Same visual
  // convention as MapPanel/SkyPanel's own internal tab rows (underline
  // accent on the active tab), so it reads as "one more tab level," not
  // a different UI language. Panel-specific sub-tabs (Spain/Global,
  // Wide/All-sky) need no changes at all -- they're already the first
  // element inside each panel's own template, so they appear directly
  // below this bar for free once that panel is the fullscreen one.
  import { fullscreenPanel, type PanelId } from '../stores/layout';

  const TABS: { id: PanelId; label: string }[] = [
    { id: 'timetable', label: 'Timetable' },
    { id: 'countdown', label: 'Countdown' },
    { id: 'map', label: 'Map' },
    { id: 'sky', label: 'Sky' },
  ];
</script>

<div class="fsbar">
  {#each TABS as t (t.id)}
    <button class:on={$fullscreenPanel === t.id} onclick={() => fullscreenPanel.set(t.id)}>
      {t.label}
    </button>
  {/each}
  <span class="fill"></span>
  <button class="exitbtn" onclick={() => fullscreenPanel.set(null)} title="Exit full screen">
    Exit full screen
  </button>
</div>

<style>
  .fsbar {
    flex: 0 0 32px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
  }
  .fsbar button {
    background: none;
    border: none;
    font-size: 13px;
    color: var(--muted);
    padding: 4px 8px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .fsbar button.on {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .fsbar .fill {
    flex: 1;
  }
  .exitbtn {
    border: 1px solid var(--line) !important;
    border-radius: 6px !important;
    font-size: 12px !important;
    color: var(--muted);
  }
  .exitbtn:hover {
    border-color: var(--muted) !important;
  }
</style>
