<script lang="ts">
  // Countdown display logic against real contact times (PLAN.md §4/§9).
  // Normally ONE line, the next upcoming event. Between C2 and C3 (during
  // totality), TWO lines: MAX and C3 -- both matter while totality is
  // running. The dev toggle is a review-only override that pins single/
  // dual view regardless of the real phase -- not part of the final UI.
  import { localCircumstances } from '../../stores/localCircumstances';
  import { now } from '../../stores/now';
  import { formatCountdown } from '../format';

  let forceDual: boolean | null = $state(null);

  const phase = $derived.by((): { mode: 'single'; key: 'c1' | 'c2' | 'max' | 'c4' } | { mode: 'dual' } => {
    const lc = $localCircumstances;
    const nowMs = $now.getTime();
    if (lc.c1 && nowMs < lc.c1.getTime()) return { mode: 'single', key: 'c1' };
    if (lc.c2 && lc.c3) {
      if (nowMs < lc.c2.getTime()) return { mode: 'single', key: 'c2' };
      if (nowMs < lc.c3.getTime()) return { mode: 'dual' };
      return { mode: 'single', key: 'c4' };
    }
    if (nowMs < lc.max.getTime()) return { mode: 'single', key: 'max' };
    return { mode: 'single', key: 'c4' };
  });
  const dual = $derived(forceDual ?? phase.mode === 'dual');

  const singleLabels = { c1: 'C1', c2: 'C2', max: 'MAX', c4: 'C4' } as const;
  const singleText = $derived.by(() => {
    if (phase.mode !== 'single') return '';
    const date = $localCircumstances[phase.key];
    if (!date) return '';
    return singleLabels[phase.key] + formatCountdown((date.getTime() - $now.getTime()) / 1000);
  });
  const maxText = $derived(
    'MAX' + formatCountdown(($localCircumstances.max.getTime() - $now.getTime()) / 1000),
  );
  const c3Text = $derived.by(() => {
    const c3 = $localCircumstances.c3;
    return c3 ? 'C3' + formatCountdown((c3.getTime() - $now.getTime()) / 1000) : '';
  });
</script>

<button class="devtoggle" onclick={() => (forceDual = !dual)}>
  {dual ? 'single view' : 'totality view'}
</button>
<div class="countdown">
  <div class="numwrap" class:dual>
    {#if dual}
      <div class="numline">{maxText}</div>
      <div class="numline">{c3Text}</div>
    {:else}
      <div class="numline">{singleText}</div>
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
