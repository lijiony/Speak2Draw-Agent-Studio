import { describe, expect, it, vi } from 'vitest';
import { loadAppSettings, saveAppSettings, toPublicSettingsSnapshot } from './appSettings';

describe('appSettings', () => {
  it('只持久化非敏感设置', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key)
      }
    });

    saveAppSettings({
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-v4-pro',
      aiTimeoutMs: 9000,
      voicePolicyMode: 'patient',
      voiceLanguage: 'zh-CN',
      showInterimTranscript: true,
      aiGenerationMode: 'editable-recipe',
      aiFallbackEnabled: true
    });

    const serialized = [...store.values()].join('\n');
    expect(serialized).not.toContain('sk-');
    expect(loadAppSettings()).toMatchObject({
      aiModel: 'deepseek-v4-pro',
      voicePolicyMode: 'patient',
      aiGenerationMode: 'editable-recipe'
    });
    expect(toPublicSettingsSnapshot(loadAppSettings(), true)).toMatchObject({
      sessionKeyConfigured: true
    });

    vi.unstubAllGlobals();
  });

  it('会清洗非法生图模式并保留合法 SVG 插画模式', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key)
      }
    });

    store.set('speak2draw.settings.v1', JSON.stringify({ aiGenerationMode: 'safe-svg-artwork' }));
    expect(loadAppSettings().aiGenerationMode).toBe('safe-svg-artwork');
    store.set('speak2draw.settings.v1', JSON.stringify({ aiGenerationMode: 'unsafe-html' }));
    expect(loadAppSettings().aiGenerationMode).toBe('editable-recipe');

    vi.unstubAllGlobals();
  });
});
