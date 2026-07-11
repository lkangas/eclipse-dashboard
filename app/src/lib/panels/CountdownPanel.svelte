<script lang="ts">
  // Countdown display logic against real contact times (PLAN.md §4/§9).
  // Normally ONE line, the next upcoming event. Two lines only between
  // C2 and Max -- once Max has passed, C3 is itself the next contact, so
  // it goes back to a single line ("C3-ttt") like everywhere else.
  //
  // C4 is only ever shown if it's actually observable -- this event is
  // sunset-limited for Spain (PLAN.md §1), and the Besselian shadow-cone
  // geometry has no concept of the horizon, so C4 commonly falls after
  // the sun has already set (even at Calamocha). When it's not
  // observable, Sunset itself becomes the countdown target instead (the
  // real end of visibility); once that's passed too, there's nothing
  // left to count down to.
  import { localCircumstances } from '../../stores/localCircumstances';
  import { effectiveTime } from '../../stores/clock';
  import { formatCountdown } from '../format';

  const phase = $derived.by(():
    | { mode: 'single'; key: 'c1' | 'c2' | 'max' | 'c3' | 'c4' | 'sunset' }
    | { mode: 'dual' }
    | { mode: 'none' } => {
    const lc = $localCircumstances;
    const nowMs = $effectiveTime.getTime();
    const sunsetMs = lc.sunset ? lc.sunset.getTime() : null;
    const c4Observable = lc.c4 && (sunsetMs === null || lc.c4.getTime() <= sunsetMs);

    function afterC3(): { mode: 'single'; key: 'c4' | 'sunset' } | { mode: 'none' } {
      if (c4Observable && nowMs < lc.c4!.getTime()) return { mode: 'single', key: 'c4' };
      if (sunsetMs !== null && nowMs < sunsetMs) return { mode: 'single', key: 'sunset' };
      return { mode: 'none' };
    }

    if (lc.c1 && nowMs < lc.c1.getTime()) return { mode: 'single', key: 'c1' };
    if (lc.c2 && lc.c3) {
      if (nowMs < lc.c2.getTime()) return { mode: 'single', key: 'c2' };
      if (nowMs < lc.max.getTime()) return { mode: 'dual' };
      if (nowMs < lc.c3.getTime()) return { mode: 'single', key: 'c3' };
      return afterC3();
    }
    if (nowMs < lc.max.getTime()) return { mode: 'single', key: 'max' };
    return afterC3();
  });
  const dual = $derived(phase.mode === 'dual');

  const singleLabels = { c1: 'C1', c2: 'C2', max: 'MAX', c3: 'C3', c4: 'C4', sunset: 'SUNSET' } as const;
  const singleText = $derived.by(() => {
    if (phase.mode !== 'single') return '';
    const date = $localCircumstances[phase.key];
    if (!date) return '';
    return singleLabels[phase.key] + formatCountdown((date.getTime() - $effectiveTime.getTime()) / 1000);
  });
  const maxText = $derived(
    'MAX' + formatCountdown(($localCircumstances.max.getTime() - $effectiveTime.getTime()) / 1000),
  );
  const c3Text = $derived.by(() => {
    const c3 = $localCircumstances.c3;
    return c3 ? 'C3' + formatCountdown((c3.getTime() - $effectiveTime.getTime()) / 1000) : '';
  });
</script>

<div class="countdown">
  <div class="numwrap" class:dual>
    {#if dual}
      <div class="numline">{maxText}</div>
      <div class="numline">{c3Text}</div>
    {:else if phase.mode === 'none'}
      <div class="numline">Event ended</div>
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
</style>
