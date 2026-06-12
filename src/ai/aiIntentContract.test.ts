import { describe, expect, it } from 'vitest';
import { buildDeepSeekMessages, normalizeAiIntent, parseDeepSeekIntentContent, toAiIntentRequestPayload } from './aiIntentContract';
import { applyCommand, createEmptyScene, createSceneObject } from '../domain/sceneModel';

describe('aiIntentContract', () => {
  it('构建发送给 DeepSeek 的场景摘要，不包含密钥', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('circle', { id: 'shape-1', name: '月亮', fill: '#2563eb' })
    });
    const payload = toAiIntentRequestPayload('让月亮更梦幻', scene, '本地规则无法理解', {
      originalTranscript: '把月亮改一下',
      question: '需要说明改成什么样。'
    });
    const messages = buildDeepSeekMessages(payload);

    expect(payload.scene.objects).toEqual([{ name: '月亮', kind: 'circle', fill: '#2563eb' }]);
    expect(payload.scene.selectedName).toBe('月亮');
    expect(payload.clarificationContext?.originalTranscript).toBe('把月亮改一下');
    expect(messages[0].content).toContain('clarificationContext');
    expect(JSON.stringify(messages)).not.toContain('DEEPSEEK_API_KEY');
  });

  it('解析并清洗 AI 返回的安全素材配方', () => {
    const intent = parseDeepSeekIntentContent(
      '```json\n{"type":"create_asset_recipe","recipe":[{"shape":"circle","name":"猫脸","color":"#f9fafb","position":{"x":1200,"y":-20},"width":999,"height":10},{"shape":"path","name":"非法路径","color":"red"}]}\n```',
      '画一只猫'
    );

    expect(intent?.type).toBe('create_asset_recipe');
    expect(intent?.recipe).toHaveLength(1);
    expect(intent?.recipe?.[0]).toMatchObject({
      shape: 'circle',
      name: '猫脸',
      color: '#f9fafb',
      position: { x: 940, y: 0 },
      width: 420,
      height: 20
    });
  });

  it('允许 AI 返回顺序意图但拒绝嵌套 sequence', () => {
    const intent = normalizeAiIntent(
      {
        type: 'sequence',
        intents: [
          { type: 'create_shape', shape: 'circle', color: '#2563eb' },
          { type: 'move_object', direction: 'right', selector: { mode: 'last' } }
        ]
      },
      '画一个蓝色圆形然后右移'
    );

    const nested = normalizeAiIntent(
      {
        type: 'sequence',
        intents: [{ type: 'sequence', intents: [{ type: 'clear_canvas' }] }]
      },
      '嵌套'
    );

    expect(intent?.type).toBe('sequence');
    expect(intent?.intents?.map((item) => item.type)).toEqual(['create_shape', 'move_object']);
    expect(nested).toBeNull();
  });
});
