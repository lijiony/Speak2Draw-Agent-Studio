import { describe, expect, it } from 'vitest';
import { TranscriptAssembler, createTranscriptCandidate } from './transcriptAssembler';

describe('TranscriptAssembler', () => {
  it('清理空白文本并补齐最终结果置信度', () => {
    const candidate = createTranscriptCandidate('  画一个红色圆形  ', 0, 12, true);
    expect(candidate).toMatchObject({
      text: '画一个红色圆形',
      confidence: 0.9,
      receivedAt: 12,
      isFinal: true
    });
  });

  it('保存最新中间识别结果用于超时兜底', () => {
    const assembler = new TranscriptAssembler();
    assembler.recordInterim('画一个房子', 0.7, 20);
    assembler.recordInterim('画一个房子和太阳', 0.8, 30);

    expect(assembler.getFallbackCandidate()).toMatchObject({
      text: '画一个房子和太阳',
      confidence: 0.8,
      receivedAt: 30,
      isFinal: false
    });
  });

  it('不会用更短的重复中间结果覆盖完整长句', () => {
    const assembler = new TranscriptAssembler();
    assembler.recordInterim('画一个房子和太阳', 0.8, 30);
    assembler.recordInterim('画一个房子', 0.9, 40);

    expect(assembler.getFallbackCandidate()).toMatchObject({
      text: '画一个房子和太阳',
      receivedAt: 30
    });
  });

  it('提交后会阻止同一轮语音重复执行', () => {
    const assembler = new TranscriptAssembler();
    const first = assembler.commit(createTranscriptCandidate('撤销', 0.8, 10, true), 50, {
      utteranceId: 'utt-1',
      startedAt: 5
    });
    const second = assembler.commit(createTranscriptCandidate('重做', 0.8, 20, true), 60);

    expect(first).toMatchObject({ text: '撤销', receivedAt: 50, isFinal: true, source: 'final', utteranceId: 'utt-1', committedAt: 50 });
    expect(second).toBeNull();
    expect(assembler.hasCommitted()).toBe(true);
  });

  it('中间识别兜底不会默认伪装成高置信度最终文本', () => {
    const assembler = new TranscriptAssembler();
    const interim = createTranscriptCandidate('删除帽子', 0, 20, false);
    const committed = assembler.commit(interim, 80, {
      utteranceId: 'utt-2',
      startedAt: 10,
      stabilityMs: 60
    });

    expect(committed).toMatchObject({
      text: '删除帽子',
      confidence: 0.5,
      source: 'interim-fallback',
      utteranceId: 'utt-2',
      stabilityMs: 60
    });
  });

  it('重置后可以进入下一轮语音', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(createTranscriptCandidate('撤销', 0.8, 10, true), 50);
    assembler.reset();

    expect(assembler.hasCommitted()).toBe(false);
    expect(assembler.commit(createTranscriptCandidate('重做', 0.8, 20, true), 60)).toMatchObject({
      text: '重做'
    });
  });

  it('不会提交空白文本', () => {
    const assembler = new TranscriptAssembler();
    expect(assembler.commit(createTranscriptCandidate('   ', 0.8, 10, true), 50)).toBeNull();
  });
});
