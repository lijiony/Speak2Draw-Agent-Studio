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

  it('选择房子不会触发复杂场景创建', () => {
    const intent = parseIntent(transcript('选择房子'));
    expect(intent.type).toBe('select_object');
    expect(intent.selector?.mode).toBe('by_name');
    expect(intent.selector?.name).toBe('房子');
  });

  it('选择红色圆形时使用形状和颜色选择器', () => {
    const intent = parseIntent(transcript('选择红色圆形'));
    expect(intent.type).toBe('select_object');
    expect(intent.selector?.mode).toBe('by_shape_color');
    expect(intent.selector?.shape).toBe('circle');
    expect(intent.selector?.color).toBe('#ef4444');
  });

  it('修正语音识别中的常见图形偏差', () => {
    const intent = parseIntent(transcript('绘制一个粉色圆型'));
    expect(intent.type).toBe('create_shape');
    expect(intent.shape).toBe('circle');
    expect(intent.color).toBe('#ec4899');
  });

  it('支持更口语化的移动方向', () => {
    const intent = parseIntent(transcript('往右边挪一点'));
    expect(intent.type).toBe('move_object');
    expect(intent.direction).toBe('right');
  });

  it('复杂场景中把名字误识别纠正为房子', () => {
    const intent = parseIntent(transcript('名字和太阳'));
    expect(intent.type).toBe('create_complex_scene');
  });

  it('明确文字输入时不把名字改成房子', () => {
    const intent = parseIntent(transcript('写名字'));
    expect(intent.type).toBe('create_shape');
    expect(intent.shape).toBe('text');
    expect(intent.text).toBe('名字');
  });

  it('编辑指令支持按对象名称指定目标', () => {
    const intent = parseIntent(transcript('把太阳改成红色'));
    expect(intent.type).toBe('update_style');
    expect(intent.selector).toMatchObject({ mode: 'by_name', name: '太阳' });
    expect(intent.color).toBe('#ef4444');
  });

  it('删除和缩放指令支持按对象名称指定目标', () => {
    expect(parseIntent(transcript('删除太阳')).selector).toMatchObject({ mode: 'by_name', name: '太阳' });
    expect(parseIntent(transcript('放大机器人')).selector).toMatchObject({ mode: 'by_name', name: '机器人' });
  });

  it('解析图层顺序调整指令', () => {
    const front = parseIntent(transcript('把太阳放到最上层'));
    expect(front.type).toBe('reorder_object');
    expect(front.selector).toMatchObject({ mode: 'by_name', name: '太阳' });
    expect(front.layer).toBe('front');

    const back = parseIntent(transcript('把房子放到最后面'));
    expect(back.type).toBe('reorder_object');
    expect(back.selector).toMatchObject({ mode: 'by_name', name: '房子' });
    expect(back.layer).toBe('back');
  });
});
