<script lang="ts">
  import TopBar from './lib/TopBar.svelte';
  import TimeBar from './lib/TimeBar.svelte';
  import FullscreenBar from './lib/FullscreenBar.svelte';
  import ContactsPanel from './lib/panels/ContactsPanel.svelte';
  import CountdownPanel from './lib/panels/CountdownPanel.svelte';
  import MapPanel from './lib/panels/MapPanel.svelte';
  import SkyPanel from './lib/panels/SkyPanel.svelte';
  import { resizable } from './lib/actions/resizable';
  import { fullscreenPanel } from './stores/layout';

  // MVP (direct request): only CountdownPanel has a real entry button
  // for now, to get one fully working, testable loop end-to-end before
  // copying the same button onto the other three panes. The underlying
  // mechanism below (fs-active/fs-hidden classes, FullscreenBar's own
  // tabs) is already fully generic across all four PanelIds -- it
  // doesn't know or care which pane's button set fullscreenPanel, so
  // switching to 'timetable'/'map'/'sky' via the ribbon already works
  // too, even without their own dedicated entry buttons yet.
</script>

<div class="app">
  <TopBar />
  {#if $fullscreenPanel}
    <FullscreenBar />
  {/if}
  <div class="main">
    <div class="col left">
      <div
        class="pane"
        class:fs-active={$fullscreenPanel === 'timetable'}
        class:fs-hidden={$fullscreenPanel !== null && $fullscreenPanel !== 'timetable'}
      >
        <ContactsPanel />
      </div>
      <div class="hsplit" class:fs-hidden={$fullscreenPanel !== null} use:resizable={{ axis: 'y' }}>
        <div class="grip"><i></i><i></i><i></i></div>
      </div>
      <div
        class="pane"
        class:fs-active={$fullscreenPanel === 'countdown'}
        class:fs-hidden={$fullscreenPanel !== null && $fullscreenPanel !== 'countdown'}
      >
        <button class="fsbtn" onclick={() => fullscreenPanel.set('countdown')} title="Full screen">
          ⛶
        </button>
        <CountdownPanel />
      </div>
    </div>

    <div class="vsplit" class:fs-hidden={$fullscreenPanel !== null} use:resizable={{ axis: 'x' }}>
      <div class="grip"><i></i><i></i><i></i></div>
    </div>

    <div class="col right">
      <div
        class="pane"
        class:fs-active={$fullscreenPanel === 'map'}
        class:fs-hidden={$fullscreenPanel !== null && $fullscreenPanel !== 'map'}
      >
        <MapPanel />
      </div>
      <div class="hsplit" class:fs-hidden={$fullscreenPanel !== null} use:resizable={{ axis: 'y' }}>
        <div class="grip"><i></i><i></i><i></i></div>
      </div>
      <div
        class="pane"
        class:fs-active={$fullscreenPanel === 'sky'}
        class:fs-hidden={$fullscreenPanel !== null && $fullscreenPanel !== 'sky'}
      >
        <SkyPanel />
      </div>
    </div>
  </div>
  <TimeBar />
</div>

<style>
  .app {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  /* position: relative so a fullscreen pane's position:absolute below
     resolves against the whole content area, not whichever .col happens
     to contain it (.col itself is never given its own `position`, so it
     wouldn't otherwise become the containing block). */
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-width: 160px;
  }
  .col.left,
  .col.right {
    flex: 1 1 0;
  }
  /* container-type: size enables the cqw/cqh sizing used by ContactsPanel
     and CountdownPanel (see those components' own comments) -- harmless
     for MapPanel/SkyPanel, which don't use container queries. */
  .pane {
    flex: 1 1 0;
    min-height: 140px;
    position: relative;
    overflow: hidden;
    container-type: size;
  }
  /* Fullscreen mode (direct request, stores/layout.ts) -- panels stay
     mounted the whole time (never conditionally destroyed/recreated),
     so entering/exiting fullscreen (or switching which panel is
     fullscreen via FullscreenBar) never resets a panel's own internal
     state (MapPanel's Spain/Global tab, SkyPanel's Wide/All-sky tab).
     The three non-active panes plus both splitters just go display:none
     (removed from layout, not merely hidden), while the active one
     escapes its .col's normal flex sizing entirely via position:absolute
     -- .col's own now-mostly-empty flex box underneath is harmless,
     since this overlay covers the full .main area regardless of
     whatever width/height the (also mostly-hidden) columns still
     nominally claim. */
  .pane.fs-active {
    position: absolute;
    inset: 0;
    z-index: 1;
  }
  .pane.fs-hidden,
  .hsplit.fs-hidden,
  .vsplit.fs-hidden {
    display: none;
  }
  /* Per-pane fullscreen entry button (MVP: only CountdownPanel has one
     so far, see the script comment) -- floats in the pane's own top-
     right corner, on top of whatever the panel renders. */
  .fsbtn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    width: 24px;
    height: 24px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.85);
    color: var(--ink);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .fsbtn:hover {
    border-color: var(--muted);
  }

  .vsplit {
    flex: 0 0 6px;
    cursor: col-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--divider);
  }
  .hsplit {
    flex: 0 0 6px;
    cursor: row-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--divider);
  }
  .grip {
    display: flex;
    gap: 3px;
  }
  .vsplit .grip {
    flex-direction: column;
  }
  .grip i {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--line);
  }
  .vsplit:hover .grip i,
  .hsplit:hover .grip i {
    background: var(--muted);
  }
</style>
