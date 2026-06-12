import { describe, expect, it } from 'vitest';
import {
  AI_INTENT_JSON_SCHEMA,
  AI_INTENT_SCHEMA_VERSION,
  buildDeepSeekMessages,
  normalizeAiIntent,
  parseDeepSeekIntentContent,
  toAiIntentRequestPayload
} from './aiIntentContract';
import { applyCommand, createEmptyScene, createSceneObject } from '../domain/sceneModel';

describe('aiIntentContract', () => {
  it('构建发送给 DeepSeek 的场景摘要，不包含密钥', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('circle', { id: 'shape-1', name: '月亮', groupId: 'asset-1', groupName: '夜空', fill: '#2563eb' })
    });
    const payload = toAiIntentRequestPayload('让月亮更梦幻', scene, '本地规则无法理解', {
      originalTranscript: '把月亮改一下',
      question: '需要说明改成什么样。'
    });
    const messages = buildDeepSeekMessages(payload);

    expect(payload.scene.objects).toEqual([{ name: '月亮', groupName: '夜空', kind: 'circle', fill: '#2563eb' }]);
    expect(payload.scene.selectedName).toBe('月亮');
    expect(payload.clarificationContext?.originalTranscript).toBe('把月亮改一下');
    expect(messages[0].content).toContain('clarificationContext');
    expect(messages[0].content).toContain(`"schemaVersion":"${AI_INTENT_SCHEMA_VERSION}"`);
    expect(messages[0].content).toContain('rename_object');
    expect(messages[0].content).toContain('duplicate_object');
    expect(messages[0].content).toContain('update_text');
    expect(messages[0].content).toContain('align_objects');
    expect(messages[0].content).toContain('distribute_objects');
    expect(AI_INTENT_JSON_SCHEMA.intentRequirements.create_shape).toContain('shape');
    expect(AI_INTENT_JSON_SCHEMA.intentRequirements.rename_object).toContain('name');
    expect(AI_INTENT_JSON_SCHEMA.intentRequirements.update_text).toContain('text');
    expect(AI_INTENT_JSON_SCHEMA.intentRequirements.align_objects).toContain('alignment');
    expect(JSON.stringify(messages)).not.toContain('DEEPSEEK_API_KEY');
  });

  it('解析固定 schema 包裹格式', () => {
    const intent = parseDeepSeekIntentContent(
      JSON.stringify({
        schemaVersion: AI_INTENT_SCHEMA_VERSION,
        intent: {
          type: 'create_shape',
          shape: 'circle',
          color: '#ef4444'
        }
      }),
      '画一个红色圆形'
    );

    expect(intent).toMatchObject({
      type: 'create_shape',
      shape: 'circle',
      color: '#ef4444'
    });
  });

  it('解析并清洗 AI 返回的安全素材配方', () => {
    const intent = parseDeepSeekIntentContent(
      '```json\n{"type":"create_asset_recipe","name":"猫","recipe":[{"shape":"circle","name":"猫脸","color":"#f9fafb","position":{"x":1200,"y":-20},"width":999,"height":10},{"shape":"path","name":"非法路径","color":"red"}]}\n```',
      '画一只猫'
    );

    expect(intent?.type).toBe('create_asset_recipe');
    expect(intent?.name).toBe('猫');
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

  it('拒绝缺少必填字段的 AI 意图', () => {
    expect(normalizeAiIntent({ type: 'create_shape', color: '#ef4444' }, '画红色的')).toBeNull();
    expect(normalizeAiIntent({ type: 'update_style', selector: { mode: 'selected' } }, '变漂亮')).toBeNull();
    expect(normalizeAiIntent({ type: 'move_object', selector: { mode: 'selected' } }, '移动一下')).toBeNull();
    expect(normalizeAiIntent({ type: 'align_objects', selector: { mode: 'all' } }, '对齐')).toBeNull();
    expect(normalizeAiIntent({ type: 'distribute_objects', selector: { mode: 'all' } }, '分布')).toBeNull();
    expect(normalizeAiIntent({ type: 'create_asset_recipe', recipe: [] }, '画一只猫')).toBeNull();
    expect(normalizeAiIntent({ type: 'clarify' }, '那个')).toBeNull();
  });

  it('接受改名、复制和文字编辑意图', () => {
    expect(
      normalizeAiIntent(
        {
          type: 'rename_object',
          selector: { mode: 'by_name', name: '月亮' },
          name: '星星'
        },
        '把月亮改名为星星'
      )
    ).toMatchObject({ type: 'rename_object', name: '星星' });

    expect(
      normalizeAiIntent(
        {
          type: 'duplicate_object',
          selector: { mode: 'by_name', name: '月亮' }
        },
        '复制月亮'
      )
    ).toMatchObject({ type: 'duplicate_object' });

    expect(
      normalizeAiIntent(
        {
          type: 'update_text',
          selector: { mode: 'selected' },
          text: '新的标题'
        },
        '把文字改成新的标题'
      )
    ).toMatchObject({ type: 'update_text', text: '新的标题' });
  });

  it('接受成组、对齐和均匀分布意图', () => {
    expect(
      normalizeAiIntent(
        {
          type: 'group_objects',
          selector: { mode: 'by_names', names: ['月亮', '太阳'] },
          name: '夜空'
        },
        '把月亮和太阳成组'
      )
    ).toMatchObject({ type: 'group_objects', selector: { mode: 'by_names', names: ['月亮', '太阳'] } });

    expect(
      normalizeAiIntent(
        {
          type: 'align_objects',
          selector: { mode: 'all' },
          alignment: 'left'
        },
        '把所有图形左对齐'
      )
    ).toMatchObject({ type: 'align_objects', alignment: 'left' });

    expect(
      normalizeAiIntent(
        {
          type: 'distribute_objects',
          selector: { mode: 'all' },
          axis: 'horizontal'
        },
        '水平分布所有图形'
      )
    ).toMatchObject({ type: 'distribute_objects', axis: 'horizontal' });
  });

  it('拒绝 sequence 中混入无法执行或澄清意图', () => {
    const intent = normalizeAiIntent(
      {
        type: 'sequence',
        intents: [
          { type: 'create_shape', shape: 'circle', color: '#2563eb' },
          { type: 'unknown', reason: '第二步不确定' }
        ]
      },
      '画圆再随便弄'
    );

    expect(intent).toBeNull();
  });
});
