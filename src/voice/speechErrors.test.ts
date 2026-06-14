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

  it('识别没有检测到语音的错误', () => {
    const info = mapSpeechError('no-speech');
    expect(info.title).toContain('没有检测到语音');
  });

  it('识别没有匹配到文字的错误', () => {
    const info = mapSpeechError('nomatch');
    expect(info.title).toContain('没有识别出文字');
  });

  it('识别浏览器没有返回文字的错误', () => {
    const info = mapSpeechError('no-transcript');
    expect(info.title).toContain('没有返回识别文字');
  });

  it('识别语音识别启动超时错误', () => {
    const info = mapSpeechError('speech-start-timeout');
    expect(info.title).toContain('启动超时');
    expect(info.action).toContain('重试');
  });
});
