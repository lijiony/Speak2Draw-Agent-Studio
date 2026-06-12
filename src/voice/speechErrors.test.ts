import { describe, expect, it } from 'vitest';
import { mapSpeechError } from './speechErrors';

describe('mapSpeechError', () => {
  it('把权限拒绝错误映射成中文操作提示', () => {
    const info = mapSpeechError('not-allowed');
    expect(info.title).toContain('权限');
    expect(info.action).toContain('地址栏');
  });

  it('识别未检测到麦克风的错误', () => {
    const info = mapSpeechError({ name: 'NotFoundError' });
    expect(info.title).toContain('未检测到麦克风');
  });

  it('识别麦克风被占用的错误', () => {
    const info = mapSpeechError({ name: 'NotReadableError' });
    expect(info.message).toContain('占用');
  });

  it('识别非安全来源错误', () => {
    const info = mapSpeechError('insecure-context');
    expect(info.action).toContain('127.0.0.1');
  });

  it('识别重复启动语音识别的错误', () => {
    const info = mapSpeechError({ name: 'InvalidStateError' });
    expect(info.title).toContain('正在运行');
    expect(info.action).toContain('不要连续点击');
  });
});
