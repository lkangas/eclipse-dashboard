import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { soundOverrides, toggleEventEnabled, setPhraseOverride } from './soundOverrides';

// This test environment has no real localStorage (vitest's default node
// environment) -- soundOverrides.ts's own try/catch around every
// localStorage call means it silently falls back to defaults rather than
// throwing on import, which these tests otherwise implicitly rely on.
// Persistence itself (does the value actually survive a reload) is a
// browser-only guarantee not exercised here; what's tested is the pure
// in-memory update logic every caller (SoundConfigPanel.svelte,
// stores/soundWarnings.ts) actually depends on.
describe('soundOverrides', () => {
  beforeEach(() => {
    soundOverrides.set({ disabledIds: [], phraseOverrides: {} });
  });

  it('starts with nothing disabled and no phrase overrides', () => {
    expect(get(soundOverrides)).toEqual({ disabledIds: [], phraseOverrides: {} });
  });

  it('toggleEventEnabled(id, false) disables an id', () => {
    toggleEventEnabled('c1:300', false);
    expect(get(soundOverrides).disabledIds).toEqual(['c1:300']);
  });

  it('toggleEventEnabled(id, true) re-enables a previously-disabled id', () => {
    toggleEventEnabled('c1:300', false);
    toggleEventEnabled('c1:300', true);
    expect(get(soundOverrides).disabledIds).toEqual([]);
  });

  it('disabling the same id twice does not duplicate it', () => {
    toggleEventEnabled('c1:300', false);
    toggleEventEnabled('c1:300', false);
    expect(get(soundOverrides).disabledIds).toEqual(['c1:300']);
  });

  it('disabling one id leaves other disabled ids untouched', () => {
    toggleEventEnabled('c1:300', false);
    toggleEventEnabled('c2:0', false);
    toggleEventEnabled('c1:300', true);
    expect(get(soundOverrides).disabledIds).toEqual(['c2:0']);
  });

  it('setPhraseOverride sets a custom phrase for an id', () => {
    setPhraseOverride('c2:15', 'Custom filters-off text!');
    expect(get(soundOverrides).phraseOverrides).toEqual({ 'c2:15': 'Custom filters-off text!' });
  });

  it('setPhraseOverride(id, null) clears the override', () => {
    setPhraseOverride('c2:15', 'Custom text');
    setPhraseOverride('c2:15', null);
    expect(get(soundOverrides).phraseOverrides).toEqual({});
  });

  it('setPhraseOverride(id, "") (blank/whitespace) also clears the override', () => {
    setPhraseOverride('c2:15', 'Custom text');
    setPhraseOverride('c2:15', '   ');
    expect(get(soundOverrides).phraseOverrides).toEqual({});
  });

  it('overrides for different ids are independent', () => {
    setPhraseOverride('c1:300', 'A');
    setPhraseOverride('c2:15', 'B');
    setPhraseOverride('c1:300', null);
    expect(get(soundOverrides).phraseOverrides).toEqual({ 'c2:15': 'B' });
  });
});
