import { describe, expect, it, vi } from 'vitest';
import { isAiIntentPayload, resolveDeepSeekIntent } from './deepSeekIntentProxy';
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
  it('未配置密钥时直接返回本地回退', async () => {
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

  it('校验代理请求载荷结构', () => {
    expect(isAiIntentPayload(payload)).toBe(true);
    expect(isAiIntentPayload({ transcript: '画圆', scene: { objects: [], revision: 0, assets: [], selection: null, selectedName: null } })).toBe(true);
    expect(isAiIntentPayload({ transcript: '画圆', scene: {} })).toBe(false);
    expect(isAiIntentPayload({ scene: { objects: [] } })).toBe(false);
  });
});
