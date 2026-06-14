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

  it('提示词发送原话和固定 SVG 要求，不用本地映射替代语义', () => {
    const payload = toAiIntentRequestPayload('画一只戴帽子的狗', createEmptyScene(), '测试', undefined, 'safe-svg-artwork');
    const messages = buildDeepSeekSvgArtworkMessages(payload);
    const userPayload = JSON.parse(messages[1].content) as {
      originalTranscript: string;
      svgRequirements: {
        preserveSemantics: string;
        maxElements: number;
        partNameLanguage: string;
      };
    };

    expect(messages[0].content).toContain('originalTranscript 是用户原话');
    expect(messages[0].content).toContain('唯一语义来源');
    expect(userPayload.originalTranscript).toBe('画一只戴帽子的狗');
    expect(userPayload.svgRequirements.maxElements).toBe(10);
    expect(userPayload.svgRequirements.partNameLanguage).toBe('中文');
    expect(userPayload.svgRequirements.preserveSemantics).toContain('戴帽子');
    expect(messages[1].content).not.toContain('dog with hat');
  });
});
