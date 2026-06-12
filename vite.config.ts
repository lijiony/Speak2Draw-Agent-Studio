import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { isAiIntentPayload, resolveDeepSeekIntent } from './src/ai/deepSeekIntentProxy';

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

      try {
        const payload = JSON.parse(await readRequestBody(bodyRequest));
        if (!isAiIntentPayload(payload)) {
          sendJson(response, 400, { ok: false, provider: 'deepseek', reason: 'AI 请求内容无效。' });
          return;
        }

        sendJson(response, 200, await resolveDeepSeekIntent(payload, env));
      } catch {
        sendJson(response, 200, { ok: false, provider: 'deepseek', reason: 'AI 指令解析请求失败。' });
      }
    });
  }
});

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
