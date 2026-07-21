<script lang="ts">
  // TopBar sound-warnings control (docs/SOUND-PLAN.md §4.1/§4.2). One
  // primary button whose click both enables (first time) and re-runs the
  // audible self-test (every time after) -- "the button is the test, not
  // a separate hidden step". A small separate mute toggle appears once
  // enabled (§4.3's full popover with category toggles/volume/persistence
  // is explicitly Phase 2 -- a single master mute is enough for Phase 1).
  import { soundEnabled, soundStatus, soundMuted, enableOrTestSound, setSoundMuted } from '../stores/soundWarnings';

  let busy = $state(false);

  async function onPrimaryClick() {
    if (busy) return;
    busy = true;
    try {
      await enableOrTestSound();
    } finally {
      busy = false;
    }
  }

  function toggleMuted() {
    setSoundMuted(!$soundMuted);
  }

  const label = $derived(
    !$soundEnabled ? '🔈 Enable Sound' : $soundMuted ? '🔇 Sound' : busy ? 'Testing…' : '🔊 Test Sound',
  );
  const title = $derived(
    !$soundEnabled
      ? 'Enable audible countdown warnings for C1/C2/Max/C3 -- plays the real tones and a spoken confirmation now, as a one-time device check. Keep the screen on and this tab in the foreground for warnings to keep firing.'
      : $soundStatus === 'degraded'
        ? 'No local text-to-speech voice found on this device -- timing tones still work, but spoken countdown announcements will not. Click to re-run the check.'
        : 'Click to re-run the tone + speech self-test at your current volume/silent-switch setting.',
  );
</script>

<div class="soundgroup">
  <button
    class="modebtn"
    class:on={$soundEnabled && !$soundMuted}
    class:degraded={$soundEnabled && $soundStatus === 'degraded' && !$soundMuted}
    disabled={busy}
    onclick={onPrimaryClick}
    {title}
  >
    {label}
    {#if $soundEnabled && $soundStatus === 'degraded' && !$soundMuted}
      <span class="degradedbadge">!</span>
    {/if}
  </button>
  {#if $soundEnabled}
    <button
      class="modebtn mutebtn"
      class:on={$soundMuted}
      onclick={toggleMuted}
      title={$soundMuted ? 'Unmute sound warnings' : 'Mute sound warnings (keeps timing running silently)'}
    >
      {$soundMuted ? '🔇' : '🔊'}
    </button>
  {/if}
  <span class="fieldnote" title="A tab that's allowed to lock or sleep can silently stop sound warnings entirely -- this isn't detectable or fixable in code.">
    Keep screen on &amp; tab in front
  </span>
</div>

<style>
  .soundgroup {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* Shares TopBar.svelte's .modebtn base styling (font/border/padding) --
     this component is only ever mounted inside TopBar, so no need to
     redeclare that shared shape here beyond the small state-specific
     overrides below. */
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
    position: relative;
  }
  .modebtn:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .modebtn.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
  }
  .modebtn.degraded {
    border-color: #c22;
  }
  .mutebtn {
    padding: 3px 6px;
  }
  .mutebtn.on {
    border-color: #c22;
    background: none;
    color: #c22;
  }
  .degradedbadge {
    display: inline-block;
    margin-left: 4px;
    background: #c22;
    color: #fff;
    border-radius: 50%;
    width: 13px;
    height: 13px;
    line-height: 13px;
    font-size: 10px;
    font-weight: 700;
    text-align: center;
  }
  /* Always visible, not just on hover (docs/SOUND-PLAN.md §5.7) -- the
     one field-usage caveat that's both unfixable in code and easy to
     forget the moment totality actually starts. */
  .fieldnote {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    cursor: help;
  }
</style>
