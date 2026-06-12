import { describe, expect, it } from 'vitest';
import { evaluateMicrophoneLevel } from './microphoneTest';

describe('evaluateMicrophoneLevel', () => {
  it('识别清晰麦克风输入', () => {
    const result = evaluateMicrophoneLevel({ peak: 0.12, average: 0.03 });
    expect(result.ok).toBe(true);
    expect(result.title).toContain('正常');
  });

  it('识别偏小但存在的麦克风输入', () => {
    const result = evaluateMicrophoneLevel({ peak: 0.03, average: 0.009 });
    expect(result.ok).toBe(true);
    expect(result.title).toContain('偏小');
  });

  it('识别几乎没有麦克风输入', () => {
    const result = evaluateMicrophoneLevel({ peak: 0.005, average: 0.001 });
    expect(result.ok).toBe(false);
    expect(result.title).toContain('几乎没有输入');
  });
});
