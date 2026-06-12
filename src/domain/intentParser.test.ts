import { describe, expect, it } from 'vitest';
import { parseIntent } from './intentParser';
import type { VoiceTranscript } from './types';

const transcript = (text: string, confidence = 0.9): VoiceTranscript => ({
  text,
  confidence,
  receivedAt: performance.now(),
  isFinal: true
});

describe('parseIntent', () => {
  it('解析基础创建指令', () => {
    const intent = parseIntent(transcript('画一个红色圆形'));
    expect(intent.type).toBe('create_shape');
    expect(intent.shape).toBe('circle');
    expect(intent.color).toBe('#ef4444');
  });

  it('解析移动和导出指令', () => {
    expect(parseIntent(transcript('向右移动一点')).direction).toBe('right');
    expect(parseIntent(transcript('导出图片')).type).toBe('export_canvas');
  });

  it('低置信度时要求澄清', () => {
    const intent = parseIntent(transcript('画一个圆', 0.2));
    expect(intent.type).toBe('clarify');
  });

  it('解析复杂组合指令', () => {
    const intent = parseIntent(transcript('画一个房子和太阳'));
    expect(intent.type).toBe('create_complex_scene');
  });
});
