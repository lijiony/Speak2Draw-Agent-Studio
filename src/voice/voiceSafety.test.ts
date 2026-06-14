import { describe, expect, it } from 'vitest';
import type { VoiceTranscript } from '../domain/types';
import {
  isClarificationCancelText,
  isConfirmationAcceptText,
  isConfirmationCancelText,
  isLikelyEcho,
  isRiskyTranscriptSource,
  looksLikeStandaloneCommand
} from './voiceSafety';

const transcript = (overrides: Partial<VoiceTranscript>): VoiceTranscript => ({
  text: '删除帽子',
  confidence: 0.95,
  receivedAt: 1,
  isFinal: true,
  source: 'final',
  ...overrides
});

describe('voiceSafety', () => {
  it('识别确认和取消词', () => {
    expect(isConfirmationAcceptText('确认。')).toBe(true);
    expect(isConfirmationAcceptText('执行')).toBe(true);
    expect(isConfirmationCancelText('取消')).toBe(true);
    expect(isConfirmationCancelText('不要')).toBe(true);
  });

  it('识别澄清取消和独立新命令', () => {
    expect(isClarificationCancelText('不用了重新开始')).toBe(true);
    expect(looksLikeStandaloneCommand('画一个红色圆形')).toBe(true);
    expect(looksLikeStandaloneCommand('戴帽子的猫')).toBe(false);
  });

  it('中间文本和低置信度文本属于危险来源', () => {
    expect(isRiskyTranscriptSource(transcript({ source: 'interim-fallback', isFinal: false }))).toBe(true);
    expect(isRiskyTranscriptSource(transcript({ confidence: 0.7 }))).toBe(true);
    expect(isRiskyTranscriptSource(transcript({ confidence: 0.95, source: 'final' }))).toBe(false);
  });

  it('可以过滤系统朗读回声', () => {
    expect(isLikelyEcho('已撤销上一步', '已撤销上一步。')).toBe(true);
    expect(isLikelyEcho('画一个红色圆形', '已撤销上一步。')).toBe(false);
    expect(isLikelyEcho('画一个红色圆形', '可以说：画一个红色圆形、画一个房子和太阳、撤销，或问我画布里有什么。')).toBe(false);
    expect(isLikelyEcho('确认', '我听到要删除帽子。请说“确认”执行，或说“取消”放弃。')).toBe(false);
  });
});
