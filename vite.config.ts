import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildDeepSeekMessages, parseDeepSeekIntentContent, type AiIntentRequestPayload } from './src/ai/aiIntentContract';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react(), deepSeekIntentProxy(env)]
  };
});

const deepSeekIntentProxy = (env: Record<string, string>): Plugin => ({
  name: 'deepseek-intent-proxy',
  configureServer(server) {
    server.middlewares.use('/api/ai/intent', async (request, response) => {
      const bodyRequest = request as RequestBodyLike;
      if (bodyRequest.method !== 'POST') {
        sendJson(response, 405, { ok: false, provider: 'local', reason: '只支持 POST 请求。' });
        return;
      }

      const apiKey = env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        sendJson(response, 200, { ok: false, provider: 'local', reason: '未配置 DEEPSEEK_API_KEY。' });
        return;
      }

      try {
        const payload = JSON.parse(await readRequestBody(bodyRequest)) as AiIntentRequestPayload;
        if (!isAiIntentPayload(payload)) {
          sendJson(response, 400, { ok: false, provider: 'deepseek', reason: 'AI 请求内容无效。' });
          return;
        }

        const model = env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
        const baseUrl = trimTrailingSlash(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
        const timeoutMs = Number(env.DEEPSEEK_TIMEOUT_MS || 8000);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const upstream = await fetch(`${baseUrl}/chat/completions`, {
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
        clearTimeout(timeout);

        if (!upstream.ok) {
          sendJson(response, 200, { ok: false, provider: 'deepseek', reason: `DeepSeek 返回 ${upstream.status}。` });
          return;
        }

        const data = (await upstream.json()) as DeepSeekChatResponse;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          sendJson(response, 200, { ok: false, provider: 'deepseek', reason: 'DeepSeek 没有返回可解析内容。' });
          return;
        }

        const intent = parseDeepSeekIntentContent(content, payload.transcript);
        if (!intent) {
          sendJson(response, 200, { ok: false, provider: 'deepseek', reason: 'DeepSeek 返回内容未通过安全校验。' });
          return;
        }

        sendJson(response, 200, { ok: true, provider: 'deepseek', model, intent });
      } catch (error) {
        const reason = error instanceof Error && error.name === 'AbortError' ? 'DeepSeek 响应超时。' : 'AI 指令解析请求失败。';
        sendJson(response, 200, { ok: false, provider: 'deepseek', reason });
      }
    });
  }
});

type DeepSeekChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type RequestBodyLike = {
  method?: string;
  setEncoding: (encoding: string) => void;
  on: (event: string, callback: (chunk?: string) => void) => void;
};

const readRequestBody = (request: RequestBodyLike) =>
  new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk = '') => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', () => reject(new Error('request body read failed')));
  });

const sendJson = (response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, status: number, body: unknown) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const isAiIntentPayload = (payload: AiIntentRequestPayload) =>
  Boolean(payload && typeof payload.transcript === 'string' && payload.scene && Array.isArray(payload.scene.objects));

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
