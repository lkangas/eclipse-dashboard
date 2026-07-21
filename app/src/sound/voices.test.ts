import { describe, expect, it } from 'vitest';
import { localVoices, preferredVoice, type VoiceInfo } from './voices';

const V = (name: string, lang: string, localService: boolean): VoiceInfo => ({ name, lang, localService });

describe('localVoices', () => {
  it('excludes every non-local (network-backed) voice', () => {
    const voices = [V('Google US English', 'en-US', false), V('Microsoft David', 'en-US', true)];
    const result = localVoices(voices);
    expect(result.map((v) => v.name)).toEqual(['Microsoft David']);
  });

  it('returns empty when every voice is network-backed', () => {
    const voices = [V('Google US English', 'en-US', false), V('Google UK English', 'en-GB', false)];
    expect(localVoices(voices)).toEqual([]);
  });

  it('returns empty when there are no voices at all', () => {
    expect(localVoices([])).toEqual([]);
  });

  it('prefers an en-tagged local voice over a non-en local voice', () => {
    const voices = [V('Microsoft Helena', 'es-ES', true), V('Microsoft David', 'en-US', true)];
    const result = localVoices(voices);
    expect(result[0].name).toBe('Microsoft David');
  });

  it('is case-insensitive about the lang tag', () => {
    const voices = [V('A', 'ES-es', true), V('B', 'EN-us', true)];
    expect(localVoices(voices)[0].name).toBe('B');
  });

  it('keeps every local voice, not just the preferred one', () => {
    const voices = [V('Microsoft Helena', 'es-ES', true), V('Microsoft David', 'en-US', true)];
    expect(localVoices(voices)).toHaveLength(2);
  });
});

describe('preferredVoice', () => {
  it('returns the single best local voice', () => {
    const voices = [V('Microsoft Helena', 'es-ES', true), V('Microsoft David', 'en-US', true)];
    expect(preferredVoice(voices)?.name).toBe('Microsoft David');
  });

  it('returns null when no local voice survives -- never falls through to a network voice', () => {
    const voices = [V('Google US English', 'en-US', false)];
    expect(preferredVoice(voices)).toBeNull();
  });

  it('returns null for an empty voice list', () => {
    expect(preferredVoice([])).toBeNull();
  });
});
