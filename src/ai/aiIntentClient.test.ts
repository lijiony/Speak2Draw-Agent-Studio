import { describe, expect, it, vi } from 'vitest';
import { resolveAiIntent, shouldUseAiIntentFallback } from './aiIntentClient';
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
      return (
      new Response(
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
      )
      );
    });

    const result = await resolveAiIntent(transcript('月亮换个梦幻感'), createEmptyScene(), '本地规则无法理解', fetcher as unknown as typeof fetch);
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

    const result = await resolveAiIntent(transcript('画一只猫'), createEmptyScene(), undefined, fetcher as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('回退到本地规则');
    }
  });
});
