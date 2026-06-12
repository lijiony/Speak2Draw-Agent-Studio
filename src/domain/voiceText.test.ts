import { describe, expect, it } from 'vitest';
import { normalizeVoiceText } from './voiceText';

describe('normalizeVoiceText', () => {
  it('清理标点和空白', () => {
    expect(normalizeVoiceText('  画 一个 红色圆形。 ')).toBe('画一个红色圆形');
  });

  it('修正常见图形识别偏差', () => {
    expect(normalizeVoiceText('画一个圆型')).toContain('圆形');
    expect(normalizeVoiceText('画一个矩型')).toContain('矩形');
  });

  it('在复杂场景语境中把名字纠正为房子', () => {
    expect(normalizeVoiceText('名字和太阳。')).toBe('房子和太阳');
  });

  it('保留明确文字输入里的名字', () => {
    expect(normalizeVoiceText('写名字')).toBe('写名字');
  });
});
