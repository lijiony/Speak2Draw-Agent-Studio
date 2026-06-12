import { isAiIntentPayload, resolveDeepSeekIntent, type DeepSeekIntentProxyEnv } from '../../src/ai/deepSeekIntentProxy';

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

    return json(await resolveDeepSeekIntent(payload, readDeepSeekEnv()));
  } catch {
    return json({ ok: false, provider: 'deepseek', reason: 'AI 指令解析请求失败。' });
  }
};

export const config = {
  path: '/api/ai/intent'
};

const readDeepSeekEnv = (): DeepSeekIntentProxyEnv => ({
  DEEPSEEK_API_KEY: Netlify.env.get('DEEPSEEK_API_KEY'),
  DEEPSEEK_BASE_URL: Netlify.env.get('DEEPSEEK_BASE_URL'),
  DEEPSEEK_MODEL: Netlify.env.get('DEEPSEEK_MODEL'),
  DEEPSEEK_TIMEOUT_MS: Netlify.env.get('DEEPSEEK_TIMEOUT_MS')
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
