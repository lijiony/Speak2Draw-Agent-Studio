import { describe, expect, it } from 'vitest';
import { buildDeepSeekSvgArtworkMessages, parseDeepSeekSvgArtworkContent } from './svgArtworkContract';
import { createEmptyScene } from '../domain/sceneModel';
import { toAiIntentRequestPayload } from './aiIntentContract';

describe('svgArtworkContract', () => {
  it('从 AI 元素 JSON 生成可清洗 SVG', () => {
    const artwork = parseDeepSeekSvgArtworkContent(
      JSON.stringify({
        schemaVersion: 'svg-artwork-1.0',
        name: '狮子',
        viewBox: '0 0 960 600',
        elements: [
          {
            tag: 'circle',
            id: 'mane',
            partName: '鬃毛',
            role: 'hair',
            attrs: { cx: 480, cy: 260, r: 110, fill: '#b45309', stroke: '#111827', 'stroke-width': 4 }
          },
          {
            tag: 'text',
            id: 'label',
            partName: '文字',
            attrs: { x: 480, y: 450, 'font-size': 24, fill: '#111827', 'text-anchor': 'middle' },
            text: 'Lion'
          }
        ],
        parts: [
          { id: 'mane', partName: '鬃毛', role: 'hair', editable: true },
          { id: 'label', partName: '文字', role: 'label', editable: true }
        ],
        qualityNotes: '几何贴纸风。'
      })
    );

    expect(artwork).toMatchObject({
      schemaVersion: 'svg-artwork-1.0',
      name: '狮子',
      parts: [
        { id: 'mane', partName: '鬃毛' },
        { id: 'label', partName: '文字' }
      ]
    });
    expect(artwork?.svg).toContain('<svg viewBox="0 0 960 600">');
    expect(artwork?.svg).toContain('data-part-name="鬃毛"');
    expect(artwork?.svg).toContain('Lion');
  });

  it('提示词发送短 brief 而不是完整 SVG 字符串要求', () => {
    const payload = toAiIntentRequestPayload('画一个狮子', createEmptyScene(), '测试', undefined, 'safe-svg-artwork');
    const messages = buildDeepSeekSvgArtworkMessages(payload);

    expect(messages[0].content).toContain('SVG element list');
    expect(messages[0].content).toContain('elements');
    expect(messages[1].content.length).toBeLessThan(600);
    expect(messages[1].content).toContain('lion');
  });
});
