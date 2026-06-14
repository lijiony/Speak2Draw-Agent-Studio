import type { EndpointPolicyMode } from '../voice/endpointPolicy';

export type AiModelName = 'deepseek-v4-flash' | 'deepseek-v4-pro';
export type AiGenerationMode = 'editable-recipe' | 'safe-svg-artwork';

export interface AppSettings {
  aiBaseUrl: string;
  aiModel: AiModelName;
  aiGenerationMode: AiGenerationMode;
  aiTimeoutMs: number;
  voicePolicyMode: EndpointPolicyMode;
  voiceLanguage: 'zh-CN';
  showInterimTranscript: boolean;
  aiFallbackEnabled: boolean;
}

export interface PublicSettingsSnapshot extends AppSettings {
  sessionKeyConfigured: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: 'deepseek-v4-flash',
  aiGenerationMode: 'editable-recipe',
  aiTimeoutMs: 15000,
  voicePolicyMode: 'balanced',
  voiceLanguage: 'zh-CN',
  showInterimTranscript: true,
  aiFallbackEnabled: true
};

const STORAGE_KEY = 'speak2draw.settings.v1';

export const loadAppSettings = (): AppSettings => {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  const queryMode = readVoicePolicyFromUrl();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return sanitizeSettings({
      ...DEFAULT_APP_SETTINGS,
      ...(isRecord(parsed) ? parsed : {}),
      ...(queryMode ? { voicePolicyMode: queryMode } : {})
    });
  } catch {
    return { ...DEFAULT_APP_SETTINGS, ...(queryMode ? { voicePolicyMode: queryMode } : {}) };
  }
};

export const saveAppSettings = (settings: AppSettings) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
};

export const resetAppSettings = () => {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
  return DEFAULT_APP_SETTINGS;
};

export const sanitizeSettings = (value: Partial<AppSettings>): AppSettings => ({
  aiBaseUrl: value.aiBaseUrl === 'https://api.deepseek.com' ? value.aiBaseUrl : DEFAULT_APP_SETTINGS.aiBaseUrl,
  aiModel: value.aiModel === 'deepseek-v4-pro' || value.aiModel === 'deepseek-v4-flash' ? value.aiModel : DEFAULT_APP_SETTINGS.aiModel,
  aiGenerationMode:
    value.aiGenerationMode === 'safe-svg-artwork' || value.aiGenerationMode === 'editable-recipe'
      ? value.aiGenerationMode
      : DEFAULT_APP_SETTINGS.aiGenerationMode,
  aiTimeoutMs: clampNumber(value.aiTimeoutMs ?? DEFAULT_APP_SETTINGS.aiTimeoutMs, 1500, 15000),
  voicePolicyMode: isPolicyMode(value.voicePolicyMode) ? value.voicePolicyMode : DEFAULT_APP_SETTINGS.voicePolicyMode,
  voiceLanguage: 'zh-CN',
  showInterimTranscript: value.showInterimTranscript !== false,
  aiFallbackEnabled: value.aiFallbackEnabled !== false
});

export const toPublicSettingsSnapshot = (settings: AppSettings, sessionKeyConfigured: boolean): PublicSettingsSnapshot => ({
  ...sanitizeSettings(settings),
  sessionKeyConfigured
});

const readVoicePolicyFromUrl = (): EndpointPolicyMode | null => {
  if (typeof window === 'undefined') return null;
  const mode = new URLSearchParams(window.location.search).get('voicePolicy');
  return isPolicyMode(mode) ? mode : null;
};

const isPolicyMode = (value: unknown): value is EndpointPolicyMode =>
  value === 'fast' || value === 'balanced' || value === 'patient';

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : DEFAULT_APP_SETTINGS.aiTimeoutMs));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
