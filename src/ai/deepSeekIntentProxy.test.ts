import { describe, expect, it, vi } from 'vitest';
import { isAiIntentPayload, resolveDeepSeekIntent, resolveDeepSeekSvgArtwork } from './deepSeekIntentProxy';
import type { AiIntentRequestPayload } from './aiIntentContract';

const payload: AiIntentRequestPayload = {
  transcript: '画一个红色圆形',
  scene: {
    revision: 0,
    objects: [],
    assets: [],
    selection: null,
    selectedName: null
  }
};

describe('deepSeekIntentProxy', () => {
  it('未配置密钥时直接返回 AI 未接管原因', async () => {
    const fetchMock = vi.fn();
    const result = await resolveDeepSeekIntent(payload, {}, fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ ok: false, provider: 'local', reason: '未配置 DEEPSEEK_API_KEY。' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('调用 OpenAI 兼容接口并解析安全意图', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: '1.0',
                  intent: {
                    type: 'create_shape',
                    shape: 'circle',
                    color: '#ef4444'
                  }
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await resolveDeepSeekIntent(
      payload,
      {
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com/',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
        DEEPSEEK_TIMEOUT_MS: '8000'
      },
      fetchMock as unknown as typeof fetch
    );

    expect(result).toMatchObject({
      ok: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      intent: { type: 'create_shape', shape: 'circle', color: '#ef4444' }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('拒绝 DeepSeek 返回的不安全内容', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"type":"create_shape","shape":"path"}' } }]
        }),
        { status: 200 }
      )
    );

    const result = await resolveDeepSeekIntent(payload, { DEEPSEEK_API_KEY: 'test-key' }, fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ ok: false, provider: 'deepseek', reason: 'DeepSeek 返回内容未通过安全校验。' });
  });

  it('安全 SVG 插画模式调用独立提示词并解析 artwork 合同', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { messages: Array<{ content: string }>; response_format?: { type: string }; max_tokens?: number };
      expect(body.messages[0].content).toContain('SVG element list');
      expect(body.messages[0].content).toContain('elements');
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.max_tokens).toBe(3000);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 'svg-artwork-1.0',
                  name: '戴帽子的小猫',
                  viewBox: '0 0 960 600',
                  elements: [
                    {
                      tag: 'rect',
                      id: 'cat-hat',
                      partName: '帽子',
                      role: 'accessory',
                      attrs: { x: 420, y: 120, width: 120, height: 70, fill: '#2563eb' }
                    }
                  ],
                  parts: [{ id: 'cat-hat', partName: '帽子', role: 'accessory', editable: true }],
                  qualityNotes: '主体居中。'
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    });

    const result = await resolveDeepSeekSvgArtwork(
      { ...payload, generationMode: 'safe-svg-artwork', transcript: '画一只戴帽子的猫' },
      { DEEPSEEK_API_KEY: 'test-key' },
      fetchMock as unknown as typeof fetch
    );

    expect(result).toMatchObject({
      ok: true,
      provider: 'deepseek',
      artwork: {
        schemaVersion: 'svg-artwork-1.0',
        name: '戴帽子的小猫',
        parts: [{ id: 'cat-hat', partName: '帽子' }]
      }
    });
  });

  it('SVG 插画超时时说明连接测试和复杂生成的区别', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const resultPromise = resolveDeepSeekSvgArtwork(
      { ...payload, generationMode: 'safe-svg-artwork', transcript: '画一只狮子' },
      {
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_TIMEOUT_MS: '1500'
      },
      fetchMock as unknown as typeof fetch
    );

    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toEqual({
      ok: false,
      provider: 'deepseek',
      reason: 'DeepSeek SVG 插画生成超时；连接测试只验证接口连通性，已优先使用 AI 可编辑配方模式。'
    });
  });

  it('校验代理请求载荷结构', () => {
    expect(isAiIntentPayload(payload)).toBe(true);
    expect(isAiIntentPayload({ transcript: '画圆', scene: { objects: [], revision: 0, assets: [], selection: null, selectedName: null } })).toBe(true);
    expect(isAiIntentPayload({ transcript: '画圆', scene: {} })).toBe(false);
    expect(isAiIntentPayload({ scene: { objects: [] } })).toBe(false);
  });
});
