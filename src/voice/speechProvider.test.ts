import { describe, expect, it } from 'vitest';
import { createBrowserSpeechRecognition } from './speechProvider';

describe('createBrowserSpeechRecognition', () => {
  it('创建并配置浏览器语音识别器', () => {
    class FakeSpeechRecognition {
      continuous = true;
      interimResults = false;
      lang = '';
    }

    const recognition = createBrowserSpeechRecognition(undefined, {
      SpeechRecognition: FakeSpeechRecognition as unknown as SpeechRecognitionConstructor
    } as Window);

    expect(recognition).toMatchObject({
      lang: 'zh-CN',
      continuous: false,
      interimResults: true
    });
  });

  it('浏览器不支持时返回 null', () => {
    const recognition = createBrowserSpeechRecognition(undefined, {} as Window);
    expect(recognition).toBeNull();
  });
});
