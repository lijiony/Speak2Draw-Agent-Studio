import { isAiIntentPayload, resolveDeepSeekIntent, resolveDeepSeekSvgArtwork, type DeepSeekIntentProxyEnv } from '../../src/ai/deepSeekIntentProxy';

declare const Netlify: {
  env: {
    get: (name: string) => string | undefined;
  };
};

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return json({ ok: false, provider: 'local', reason: '只支持 POST 请求。' }, 405);
  }

  try {
    const payload = await request.json();
    if (!isAiIntentPayload(payload)) {
      return json({ ok: false, provider: 'deepseek', reason: 'AI 请求内容无效。' }, 400);
    }

    const env = readDeepSeekEnv(request);
    return json(payload.generationMode === 'safe-svg-artwork' ? await resolveDeepSeekSvgArtwork(payload, env) : await resolveDeepSeekIntent(payload, env));
  } catch {
    return json({ ok: false, provider: 'deepseek', reason: 'AI 指令解析请求失败。' });
  }
};

export const config = {
  path: '/api/ai/intent'
};

const readDeepSeekEnv = (request: Request): DeepSeekIntentProxyEnv => ({
  DEEPSEEK_API_KEY: request.headers.get('x-speak2draw-session-key') || Netlify.env.get('DEEPSEEK_API_KEY'),
  DEEPSEEK_BASE_URL: request.headers.get('x-speak2draw-base-url') || Netlify.env.get('DEEPSEEK_BASE_URL'),
  DEEPSEEK_MODEL: request.headers.get('x-speak2draw-model') || Netlify.env.get('DEEPSEEK_MODEL'),
  DEEPSEEK_TIMEOUT_MS: request.headers.get('x-speak2draw-timeout-ms') || Netlify.env.get('DEEPSEEK_TIMEOUT_MS')
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
