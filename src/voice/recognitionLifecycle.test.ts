import { describe, expect, it } from 'vitest';
import { resolveRecognitionEndAction } from './recognitionLifecycle';

describe('resolveRecognitionEndAction', () => {
  it('连续监听时如果识别器结束但已有中间文本，会先提交文本再重启', () => {
    expect(
      resolveRecognitionEndAction({
        listeningRequested: true,
        status: 'listening',
        hasPendingFallback: true
      })
    ).toBe('commit_fallback_and_restart');
  });

  it('连续监听时没有待提交文本，则只重启下一轮监听', () => {
    expect(
      resolveRecognitionEndAction({
        listeningRequested: true,
        status: 'listening',
        hasPendingFallback: false
      })
    ).toBe('restart');
  });

  it('用户没有请求继续监听时，正常回到空闲状态', () => {
    expect(
      resolveRecognitionEndAction({
        listeningRequested: false,
        status: 'starting',
        hasPendingFallback: false
      })
    ).toBe('idle');
  });
});
