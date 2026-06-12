import { describe, expect, it } from 'vitest';
import { collectRecognitionSnapshot } from './recognitionSnapshot';

describe('collectRecognitionSnapshot', () => {
  it('把多个最终片段合并成完整最终文本', () => {
    const snapshot = collectRecognitionSnapshot(
      results([
        ['画一个房子', 0.9, true],
        ['和太阳', 0.8, true]
      ]),
      100
    );

    expect(snapshot).toMatchObject({
      text: '画一个房子和太阳',
      confidence: 0.85,
      receivedAt: 100,
      isFinal: true
    });
  });

  it('只要仍有中间片段，就保持中间状态等待补充', () => {
    const snapshot = collectRecognitionSnapshot(
      results([
        ['画一个房子', 0.9, true],
        ['和太阳', 0.7, false]
      ]),
      120
    );

    expect(snapshot).toMatchObject({
      text: '画一个房子和太阳',
      confidence: 0.8,
      isFinal: false
    });
  });

  it('空白结果不会生成可提交候选', () => {
    expect(collectRecognitionSnapshot(results([['   ', 0, false]]), 140)).toBeNull();
  });
});

const results = (items: Array<[string, number, boolean]>) =>
  items.map(([transcript, confidence, isFinal]) => ({
    isFinal,
    length: 1,
    0: { transcript, confidence },
    item: () => ({ transcript, confidence })
  })) as unknown as SpeechRecognitionResultList;
