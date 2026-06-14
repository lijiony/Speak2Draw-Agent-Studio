import {
  buildDeepSeekMessages,
  getAiIntentSchemaVersion,
  parseDeepSeekIntentContent,
  summarizeDeepSeekIntentContent,
  type AiIntentRequestPayload,
  type AiIntentResponsePayload
} from './aiIntentContract';
import {
  buildDeepSeekSvgArtworkMessages,
  parseDeepSeekSvgArtworkContent,
  summarizeDeepSeekSvgArtworkContent,
  SVG_ARTWORK_SCHEMA_VERSION,
  type AiSvgArtworkResponsePayload
} from './svgArtworkContract';

export interface DeepSeekIntentProxyEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_TIMEOUT_MS?: string;
}

type DeepSeekChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export const resolveDeepSeekIntent = async (
  payload: AiIntentRequestPayload,
  env: DeepSeekIntentProxyEnv,
  fetchImpl: typeof fetch = fetch
): Promise<AiIntentResponsePayload> => {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return { ok: false, provider: 'local', reason: '未配置 DEEPSEEK_API_KEY。' };

  const model = safeModel(env.DEEPSEEK_MODEL);
  const baseUrl = safeDeepSeekBaseUrl(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
  if (!baseUrl) return { ok: false, provider: 'deepseek', reason: 'DeepSeek base URL 不在允许范围内。' };
  const timeoutMs = safeTimeoutMs(env.DEEPSEEK_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: buildDeepSeekMessages(payload),
        temperature: 0
      })
    });

    if (!upstream.ok) return { ok: false, provider: 'deepseek', reason: `DeepSeek 返回 ${upstream.status}。` };

    const data = (await upstream.json()) as DeepSeekChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, provider: 'deepseek', reason: 'DeepSeek 没有返回可解析内容。' };

    const intent = parseDeepSeekIntentContent(content, payload.transcript);
    if (!intent) return { ok: false, provider: 'deepseek', reason: 'DeepSeek 返回内容未通过安全校验。' };

    return {
      ok: true,
      provider: 'deepseek',
      model,
      intent,
      schemaVersion: getAiIntentSchemaVersion(content),
      rawIntentSummary: summarizeDeepSeekIntentContent(content)
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'DeepSeek 响应超时。' : 'AI 指令解析请求失败。';
    return { ok: false, provider: 'deepseek', reason };
  } finally {
    clearTimeout(timeout);
  }
};

export const isAiIntentPayload = (payload: unknown): payload is AiIntentRequestPayload =>
  Boolean(
    payload &&
      typeof payload === 'object' &&
      'transcript' in payload &&
      typeof payload.transcript === 'string' &&
      payload.transcript.length <= 500 &&
      'scene' in payload &&
      payload.scene &&
      typeof payload.scene === 'object' &&
      'objects' in payload.scene &&
      Array.isArray(payload.scene.objects) &&
      payload.scene.objects.length <= 80
  );

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const safeTimeoutMs = (value?: string) => {
  const parsed = Number(value || 15000);
  if (!Number.isFinite(parsed)) return 15000;
  return Math.round(Math.min(15000, Math.max(1500, parsed)));
};

export const resolveDeepSeekSvgArtwork = async (
  payload: AiIntentRequestPayload,
  env: DeepSeekIntentProxyEnv,
  fetchImpl: typeof fetch = fetch
): Promise<AiSvgArtworkResponsePayload> => {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return { ok: false, provider: 'local', reason: '未配置 DEEPSEEK_API_KEY。' };

  const model = safeModel(env.DEEPSEEK_MODEL);
  const baseUrl = safeDeepSeekBaseUrl(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
  if (!baseUrl) return { ok: false, provider: 'deepseek', reason: 'DeepSeek base URL 不在允许范围内。' };
  const timeoutMs = safeTimeoutMs(env.DEEPSEEK_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: buildDeepSeekSvgArtworkMessages(payload),
        temperature: 0.2
      })
    });

    if (!upstream.ok) return { ok: false, provider: 'deepseek', reason: `DeepSeek 返回 ${upstream.status}。` };

    const data = (await upstream.json()) as DeepSeekChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, provider: 'deepseek', reason: 'DeepSeek 没有返回可解析内容。' };

    const artwork = parseDeepSeekSvgArtworkContent(content);
    if (!artwork) return { ok: false, provider: 'deepseek', reason: 'DeepSeek SVG 插画未通过结构校验。' };

    return {
      ok: true,
      provider: 'deepseek',
      model,
      artwork,
      schemaVersion: SVG_ARTWORK_SCHEMA_VERSION,
      rawIntentSummary: summarizeDeepSeekSvgArtworkContent(content)
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'DeepSeek 响应超时。' : 'AI SVG 插画请求失败。';
    return { ok: false, provider: 'deepseek', reason };
  } finally {
    clearTimeout(timeout);
  }
};

const safeDeepSeekBaseUrl = (value: string) => {
  try {
    const url = new URL(trimTrailingSlash(value));
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'api.deepseek.com') return null;
    if (url.pathname !== '' && url.pathname !== '/') return null;
    return trimTrailingSlash(url.toString());
  } catch {
    return null;
  }
};

const safeModel = (value?: string) =>
  value === 'deepseek-v4-pro' || value === 'deepseek-v4-flash' ? value : 'deepseek-v4-flash';
