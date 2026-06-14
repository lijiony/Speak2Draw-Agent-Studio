import { describe, expect, it, vi } from 'vitest';
import { resolveAiIntent, resolveAiSvgArtwork, shouldUseAiIntentFallback } from './aiIntentClient';
import { createEmptyScene } from '../domain/sceneModel';
import type { DrawingIntent, VoiceTranscript } from '../domain/types';

const transcript = (text: string, confidence = 0.95): VoiceTranscript => ({
  text,
  confidence,
  receivedAt: performance.now(),
  isFinal: true
});

describe('aiIntentClient', () => {
  it('只在本地规则不确定时启用 AI 兜底', () => {
    expect(shouldUseAiIntentFallback({ type: 'unknown', rawText: '随便画点梦幻的东西' }, { needsClarification: true }, transcript('随便画点梦幻的东西'))).toBe(true);
    expect(shouldUseAiIntentFallback({ type: 'create_shape', rawText: '画圆形', shape: 'circle' }, {}, transcript('画圆形'))).toBe(false);
    expect(shouldUseAiIntentFallback({ type: 'clarify', rawText: '画圆形', reason: '置信度低' }, { needsClarification: true }, transcript('画圆形', 0.2))).toBe(false);
  });

  it('请求代理并重新校验 AI 返回的意图', async () => {
    let submittedBody = '';
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      submittedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          ok: true,
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          intent: {
            type: 'update_style',
            selector: { mode: 'by_name', name: '月亮' },
            color: '#ec4899'
          } satisfies Partial<DrawingIntent>
        }),
        { status: 200 }
      );
    });

    const result = await resolveAiIntent(transcript('月亮换个梦幻感'), createEmptyScene(), '本地规则无法理解', undefined, undefined, fetcher as unknown as typeof fetch);
    const requestBody = JSON.parse(submittedBody) as { transcript: string; localReason?: string };

    expect(requestBody).toMatchObject({ transcript: '月亮换个梦幻感', localReason: '本地规则无法理解' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent).toMatchObject({
        type: 'update_style',
        selector: { mode: 'by_name', name: '月亮' },
        color: '#ec4899'
      });
    }
  });

  it('AI 不可用时返回安全失败结果', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network');
    });

    const result = await resolveAiIntent(transcript('画一只猫'), createEmptyScene(), undefined, undefined, undefined, fetcher as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('回退到本地规则');
    }
  });

  it('代理返回未配置原因时传递给前端', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          provider: 'local',
          reason: '未配置 DEEPSEEK_API_KEY。'
        }),
        { status: 200 }
      )
    );

    const result = await resolveAiIntent(transcript('月亮换个梦幻感'), createEmptyScene(), undefined, undefined, undefined, fetcher as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.provider).toBe('local');
      expect(result.reason).toBe('未配置 DEEPSEEK_API_KEY。');
    }
  });

  it('发送上一轮澄清上下文给 AI', async () => {
    let submittedBody = '';
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      submittedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          ok: true,
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          intent: {
            type: 'create_shape',
            shape: 'circle',
            color: '#ef4444'
          } satisfies Partial<DrawingIntent>
        }),
        { status: 200 }
      );
    });

    await resolveAiIntent(
      transcript('红色圆形'),
      createEmptyScene(),
      '上一轮需要澄清',
      {
        originalTranscript: '画一个',
        question: '听到了创建指令，但没有识别出要画的图形。',
        reason: '缺少图形'
      },
      undefined,
      fetcher as unknown as typeof fetch
    );

    const requestBody = JSON.parse(submittedBody) as {
      transcript: string;
      clarificationContext?: { originalTranscript: string; question: string; reason?: string };
    };
    expect(requestBody).toMatchObject({
      transcript: '红色圆形',
      clarificationContext: {
        originalTranscript: '画一个',
        question: '听到了创建指令，但没有识别出要画的图形。',
        reason: '缺少图形'
      }
    });
  });

  it('会话 API key 只通过请求头发送，不进入 AI payload', async () => {
    let submittedBody = '';
    let submittedHeaders: HeadersInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      submittedBody = init?.body as string;
      submittedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          ok: false,
          provider: 'local',
          reason: '测试'
        }),
        { status: 200 }
      );
    });

    await resolveAiIntent(
      transcript('画一只猫'),
      createEmptyScene(),
      undefined,
      undefined,
      {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
        timeoutMs: 9000,
        sessionApiKey: 'session-secret'
      },
      fetcher as unknown as typeof fetch
    );

    expect(JSON.parse(submittedBody)).not.toMatchObject({ sessionApiKey: 'session-secret' });
    expect(submittedBody).not.toContain('session-secret');
    expect(submittedHeaders).toMatchObject({
      'X-Speak2Draw-Session-Key': 'session-secret',
      'X-Speak2Draw-Model': 'deepseek-v4-pro'
    });
  });

  it('请求安全 SVG 插画时使用独立生图模式并校验包裹格式', async () => {
    let submittedBody = '';
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      submittedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          ok: true,
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          schemaVersion: 'svg-artwork-1.0',
          rawIntentSummary: 'svg_artwork:戴帽子的小猫, parts 2',
          artwork: {
            schemaVersion: 'svg-artwork-1.0',
            name: '戴帽子的小猫',
            viewBox: '0 0 960 600',
            svg: '<svg viewBox="0 0 960 600"><g id="cat-hat" data-part-name="帽子"><rect x="420" y="120" width="120" height="70" fill="#2563eb"/></g></svg>',
            parts: [{ id: 'cat-hat', partName: '帽子', role: 'accessory', editable: true }],
            qualityNotes: '主体居中。'
          }
        }),
        { status: 200 }
      );
    });

    const result = await resolveAiSvgArtwork(transcript('画一只戴帽子的猫'), createEmptyScene(), '本地无法表达', undefined, undefined, fetcher as unknown as typeof fetch);
    const requestBody = JSON.parse(submittedBody) as { generationMode?: string; transcript: string };

    expect(requestBody).toMatchObject({
      generationMode: 'safe-svg-artwork',
      transcript: '画一只戴帽子的猫'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artwork.name).toBe('戴帽子的小猫');
      expect(result.artwork.parts[0]).toMatchObject({ id: 'cat-hat', partName: '帽子' });
    }
  });
});
