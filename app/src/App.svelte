<script lang="ts">
  import TopBar from './lib/TopBar.svelte';
  import TimeBar from './lib/TimeBar.svelte';
  import ContactsPanel from './lib/panels/ContactsPanel.svelte';
  import CountdownPanel from './lib/panels/CountdownPanel.svelte';
  import MapPanel from './lib/panels/MapPanel.svelte';
  import SkyPanel from './lib/panels/SkyPanel.svelte';
  import { resizable } from './lib/actions/resizable';
</script>

<div class="app">
  <TopBar />
  <div class="main">
    <div class="col left">
      <div class="pane">
        <ContactsPanel />
      </div>
      <div class="hsplit" use:resizable={{ axis: 'y' }}>
        <div class="grip"><i></i><i></i><i></i></div>
      </div>
      <div class="pane">
        <CountdownPanel />
      </div>
    </div>

    <div class="vsplit" use:resizable={{ axis: 'x' }}>
      <div class="grip"><i></i><i></i><i></i></div>
    </div>

    <div class="col right">
      <div class="pane">
        <MapPanel />
      </div>
      <div class="hsplit" use:resizable={{ axis: 'y' }}>
        <div class="grip"><i></i><i></i><i></i></div>
      </div>
      <div class="pane">
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
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
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
