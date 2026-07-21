<script lang="ts">
  // Sound Warnings config view (direct request) -- shows every individual
  // sound event sound/eligibility.ts's soundEligibleEvents() computes for
  // the current observer (every countdown-ladder rung, each contact's own
  // tone, Max, and the standalone C3+15s filters-on call -- ~23 entries
  // for a full totality), grouped by contact, with a per-event enable/
  // disable toggle and editable spoken text. Toggles/edits write through
  // stores/soundOverrides.ts, which stores/soundWarnings.ts's own
  // eligibleEvents derived already filters/relabels against -- this
  // component only ever READS soundEligibleEvents() for display and calls
  // the override setters; it has no scheduling logic of its own.
  import { localCircumstances } from '../../stores/localCircumstances';
  import { soundEligibleEvents, type SoundEvent, type SoundEventKey } from '../../sound/eligibility';
  import { soundOverrides, toggleEventEnabled, setPhraseOverride } from '../../stores/soundOverrides';

  const KEY_LABELS: Record<SoundEventKey, string> = { c1: 'C1', c2: 'C2', max: 'Max', c3: 'C3' };
  const KEY_ORDER: SoundEventKey[] = ['c1', 'c2', 'max', 'c3'];

  const baseEvents = $derived(soundEligibleEvents($localCircumstances));

  // Groups preserve each contact's own chronological order (the source
  // list is already fully sorted); KEY_ORDER just fixes which group comes
  // first, since Max's single instant would otherwise sort in wherever it
  // falls relative to C2/C3 and split the visual grouping oddly.
  const groups = $derived.by(() => {
    const byKey = new Map<SoundEventKey, SoundEvent[]>();
    for (const ev of baseEvents) {
      if (!byKey.has(ev.key)) byKey.set(ev.key, []);
      byKey.get(ev.key)!.push(ev);
    }
    return KEY_ORDER.filter((k) => byKey.has(k)).map((k) => ({ key: k, events: byKey.get(k)! }));
  });

  // "5 min before C1" / "At C2" / "15s after C3" -- derived directly from
  // the actual Date difference against this contact's own instant, not
  // parsed back out of the id string (id formats -- "c1:300", "c3:filters-
  // on" -- are an internal scheduling detail, not something this display
  // logic should need to understand).
  function leadLabel(ev: SoundEvent): string {
    const lc = $localCircumstances;
    const contactTime = ev.key === 'max' ? lc.max : lc[ev.key];
    if (!contactTime) return KEY_LABELS[ev.key];
    const diffS = Math.round((contactTime.getTime() - ev.time.getTime()) / 1000);
    if (diffS === 0) return `At ${KEY_LABELS[ev.key]}`;
    const abs = Math.abs(diffS);
    const magnitude = abs >= 60 ? `${Math.round(abs / 60)} min` : `${abs}s`;
    return diffS > 0 ? `${magnitude} before ${KEY_LABELS[ev.key]}` : `${magnitude} after ${KEY_LABELS[ev.key]}`;
  }

  let editingId = $state<string | null>(null);
  let editText = $state('');

  function isDisabled(id: string): boolean {
    return $soundOverrides.disabledIds.includes(id);
  }
  function effectivePhrase(ev: SoundEvent): string | null {
    if (ev.phrase === null) return null;
    return $soundOverrides.phraseOverrides[ev.id] ?? ev.phrase;
  }
  function isOverridden(id: string): boolean {
    return $soundOverrides.phraseOverrides[id] !== undefined;
  }

  function startEdit(ev: SoundEvent): void {
    if (ev.phrase === null) return;
    editingId = ev.id;
    editText = effectivePhrase(ev) ?? '';
  }
  function commitEdit(): void {
    if (editingId) setPhraseOverride(editingId, editText);
    editingId = null;
  }
  function cancelEdit(): void {
    editingId = null;
  }
  function resetPhrase(id: string): void {
    setPhraseOverride(id, null);
  }
</script>

<div class="soundconfig">
  <div class="header">
    <span>Sound Warnings</span>
    <span class="subhead">Toggle individual events off, or edit what gets said. Timing tones have no text to edit.</span>
  </div>
  <div class="list">
    {#if groups.length === 0}
      <div class="empty">No sound-eligible events for this observer/date.</div>
    {/if}
    {#each groups as group (group.key)}
      <div class="group">
        <div class="groupheader">{KEY_LABELS[group.key]}</div>
        {#each group.events as ev (ev.id)}
          {@const disabled = isDisabled(ev.id)}
          <div class="row" class:disabled>
            <button
              class="rowtoggle"
              class:on={!disabled}
              onclick={() => toggleEventEnabled(ev.id, disabled)}
              title={disabled ? 'Disabled -- click to re-enable' : 'Enabled -- click to disable'}
            >
              {disabled ? 'Off' : 'On'}
            </button>
            <span class="channelicon" title={ev.channel === 'tone' ? 'Timing tone' : 'Spoken announcement'}>
              {ev.channel === 'tone' ? '🔔' : '💬'}
            </span>
            <span class="lead">{leadLabel(ev)}</span>
            {#if ev.phrase === null}
              <span class="tonenote">(tone, no text)</span>
            {:else if editingId === ev.id}
              <input
                class="phraseinput"
                bind:value={editText}
                onblur={commitEdit}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
              />
            {:else}
              <button class="phrasebtn" onclick={() => startEdit(ev)} title="Click to edit the spoken text">
                {effectivePhrase(ev)}
              </button>
              {#if isOverridden(ev.id)}
                <button class="resetbtn" onclick={() => resetPhrase(ev.id)} title="Reset to the default text">
                  ↺
                </button>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .soundconfig {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 14px 14px 8px;
  }
  .header {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 6px;
  }
  .header > span:first-child {
    font-size: 14px;
    font-weight: 600;
  }
  .subhead {
    font-size: 11px;
    color: var(--muted);
  }
  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .empty {
    color: var(--muted);
    font-size: 12px;
    padding: 8px 0;
  }
  .group + .group {
    margin-top: 10px;
  }
  .groupheader {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.4px;
    color: var(--muted);
    padding: 4px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .row.disabled {
    opacity: 0.45;
  }
  .rowtoggle {
    flex-shrink: 0;
    width: 32px;
    font: inherit;
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 2px 0;
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    text-align: center;
  }
  .rowtoggle.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
  }
  .channelicon {
    flex-shrink: 0;
    font-size: 13px;
    cursor: help;
  }
  .lead {
    flex-shrink: 0;
    width: 110px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tonenote {
    color: var(--muted);
    font-style: italic;
  }
  .phrasebtn {
    flex: 1 1 auto;
    text-align: left;
    font: inherit;
    background: none;
    border: 1px dashed transparent;
    border-radius: 4px;
    padding: 2px 4px;
    color: var(--ink);
    cursor: text;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .phrasebtn:hover {
    border-color: var(--line);
  }
  .phraseinput {
    flex: 1 1 auto;
    font: inherit;
    color: var(--ink);
    background: var(--screen);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 4px;
    min-width: 0;
  }
  .resetbtn {
    flex-shrink: 0;
    font: inherit;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0 2px;
  }
  .resetbtn:hover {
    color: var(--ink);
  }
</style>
