import {
  buildDeepSeekMessages,
  parseDeepSeekIntentContent,
  type AiIntentRequestPayload,
  type AiIntentResponsePayload
} from './aiIntentContract';

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

  const model = env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const baseUrl = trimTrailingSlash(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
  const timeoutMs = Number(env.DEEPSEEK_TIMEOUT_MS || 8000);
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

    return { ok: true, provider: 'deepseek', model, intent };
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
      'scene' in payload &&
      payload.scene &&
      typeof payload.scene === 'object' &&
      'objects' in payload.scene &&
      Array.isArray(payload.scene.objects)
  );

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
