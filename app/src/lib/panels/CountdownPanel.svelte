<script lang="ts">
  // Countdown display logic (layout designed for both; not driven by a
  // real clock yet -- STUB values ported from the mock). Normally ONE
  // line, the next upcoming event. Between C2 and C3 (during totality),
  // TWO lines: MAX and C3 -- both matter while totality is running. The
  // dev toggle below is a review-only aid to compare both states -- not
  // part of the final UI.
  let dual = $state(false);
</script>

<button class="devtoggle" onclick={() => (dual = !dual)}>
  {dual ? 'single view' : 'totality view'}
</button>
<div class="countdown">
  <div class="numwrap" class:dual>
    {#if dual}
      <div class="numline">MAX−01:21</div>
      <div class="numline">C3−02:05</div>
    {:else}
      <div class="numline">C2−00:41.6</div>
    {/if}
  </div>
  <svg viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="44" fill="none" stroke="#20201e" stroke-width="1.5" />
    <circle cx="53" cy="61" r="45.3" fill="#20201e" />
  </svg>
</div>

<style>
  /* Sized off native cqw/cqh -- deliberately with NO fixed-pixel ceiling
     anywhere in the formula, unlike the contacts table: a fixed ceiling is
     not physically zoom-invariant, so this panel should fill available
     space unconditionally. The floor (20px/16px) is a plain literal and
     only matters in the already-extreme small-panel case. Requires the
     nearest ancestor (App.svelte's .pane) to set container-type: size. */
  .countdown {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 14px;
    padding: 10px;
  }
  .numwrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
  }
  .numwrap .numline {
    font-family: 'SF Mono', 'Cascadia Mono', Consolas, monospace;
    font-weight: 500;
    letter-spacing: -0.5px;
    white-space: nowrap;
    font-size: max(20px, min(14cqw, 20cqh));
  }
  .numwrap.dual .numline {
    font-size: max(16px, min(16cqw, 12cqh));
  }
  .countdown svg {
    width: max(50px, min(40cqw, 56cqh));
    height: max(50px, min(40cqw, 56cqh));
    flex-shrink: 0;
  }
  /* MAX and C3 (during totality) go side by side once there's room, else
     stacked. */
  @container (min-width: 500px) {
    .numwrap.dual {
      flex-direction: row;
      gap: 28px;
    }
  }

  /* review-only control, not final UI */
  .devtoggle {
    position: absolute;
    top: 10px;
    right: 12px;
    z-index: 2;
    background: none;
    border: 1px dashed var(--line);
    color: var(--muted);
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 20px;
    cursor: pointer;
  }
  .devtoggle:hover {
    color: var(--ink);
    border-color: var(--muted);
  }
</style>
