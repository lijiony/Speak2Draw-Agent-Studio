import { describe, expect, it, beforeEach } from 'vitest';
import { planCommands, resetCommandIdsForTest } from './commandPlanner';
import { parseIntent } from './intentParser';
import { applyCommand, applyCommandsAsTransaction, createEmptyScene, createSceneObject } from './sceneModel';
import type { DrawingIntent, VoiceTranscript } from './types';

const transcript = (text: string): VoiceTranscript => ({
  text,
  confidence: 0.95,
  receivedAt: performance.now(),
  isFinal: true
});

describe('planCommands', () => {
  beforeEach(() => resetCommandIdsForTest());

  it('把复杂房子指令拆成多步绘图命令', () => {
    const intent: DrawingIntent = { type: 'create_complex_scene', rawText: '画一个房子和太阳' };
    const plan = planCommands(intent, createEmptyScene());
    expect(plan.commands.length).toBeGreaterThan(4);
    expect(plan.commands.every((command) => command.type === 'create_object')).toBe(true);
  });

  it('内置房子部件会自动组成同一个素材组', () => {
    const intent: DrawingIntent = { type: 'create_complex_scene', rawText: '画一个房子' };
    const plan = planCommands(intent, createEmptyScene());
    const houseObjects = plan.commands.map((command) => command.object).filter((object) => object?.name.includes('房子'));

    expect(houseObjects).toHaveLength(4);
    expect(houseObjects.map((object) => object?.groupName)).toEqual(['房子', '房子', '房子', '房子']);
    expect(new Set(houseObjects.map((object) => object?.groupId)).size).toBe(1);
  });

  it('没有对象时，编辑指令要求澄清', () => {
    const intent: DrawingIntent = { type: 'move_object', rawText: '向右移动一点', selector: { mode: 'selected' }, direction: 'right' };
    const plan = planCommands(intent, createEmptyScene());
    expect(plan.needsClarification).toBe(true);
  });

  it('按归一化后的复杂场景文本生成绘图步骤', () => {
    const intent: DrawingIntent = { type: 'create_complex_scene', rawText: '名字和太阳。' };
    const plan = planCommands(intent, createEmptyScene());
    const objectNames = plan.commands.map((command) => command.object?.name ?? '');

    expect(objectNames.some((name) => name.includes('房子'))).toBe(true);
    expect(objectNames).toContain('太阳');
  });

  it('普通多图形组合会按形状和颜色拆解', () => {
    const intent = parseIntent(transcript('画一个蓝色圆形和绿色矩形'));
    const plan = planCommands(intent, createEmptyScene());

    expect(intent.type).toBe('create_complex_scene');
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands.map((command) => command.object?.kind)).toEqual(['circle', 'rectangle']);
    expect(plan.commands.map((command) => command.object?.style.fill)).toEqual(['#2563eb', '#16a34a']);
  });

  it('AI 素材配方会转换为安全绘图命令', () => {
    const plan = planCommands(
      {
        type: 'create_asset_recipe',
        rawText: '画一只猫',
        name: '猫',
        recipe: [
          { shape: 'circle', name: '猫脸', color: '#f9fafb', position: { x: 360, y: 220 }, width: 160, height: 140 },
          { shape: 'triangle', name: '猫左耳', color: '#f9fafb', position: { x: 360, y: 190 }, width: 60, height: 70 },
          { shape: 'triangle', name: '猫右耳', color: '#f9fafb', position: { x: 460, y: 190 }, width: 60, height: 70 }
        ]
      },
      createEmptyScene()
    );

    expect(plan.commands).toHaveLength(3);
    expect(plan.commands.map((command) => command.object?.name)).toEqual(['猫脸', '猫左耳', '猫右耳']);
    expect(plan.commands.map((command) => command.object?.groupName)).toEqual(['猫', '猫', '猫']);
    expect(new Set(plan.commands.map((command) => command.object?.groupId)).size).toBe(1);
    expect(plan.commands[0].object).toMatchObject({
      kind: 'circle',
      width: 160,
      height: 140,
      style: { fill: '#f9fafb' }
    });
  });

  it('AI 素材配方缺少组名时会从语音推断', () => {
    const plan = planCommands(
      {
        type: 'create_asset_recipe',
        rawText: '画一只戴帽子的猫',
        recipe: [
          { shape: 'circle', name: '猫脸', color: '#f9fafb' },
          { shape: 'rectangle', name: '帽子', color: '#ef4444' }
        ]
      },
      createEmptyScene()
    );

    expect(plan.commands.map((command) => command.object?.groupName)).toEqual(['戴帽子的猫', '戴帽子的猫']);
  });

  it('AI 语义配方即使没有 position 也会生成稳定布局诊断', () => {
    const plan = planCommands(
      {
        type: 'create_asset_recipe',
        rawText: '画一只戴帽子的猫',
        name: '戴帽子的小猫',
        recipe: [
          { shape: 'circle', name: '小猫脸', partName: '脸', slot: 'center', size: 'large', color: '#f8fafc' },
          { shape: 'triangle', name: '左耳', partName: '耳朵', slot: 'top-left', relativeTo: '脸', size: 'small', color: '#f8fafc' },
          { shape: 'rectangle', name: '帽子', partName: '帽子', slot: 'top', relativeTo: '脸', size: 'small', color: '#ef4444' }
        ]
      },
      createEmptyScene()
    );

    const face = plan.commands.find((command) => command.object?.partName === '脸')?.object;
    const hat = plan.commands.find((command) => command.object?.partName === '帽子')?.object;

    expect(plan.commands).toHaveLength(3);
    expect(plan.layoutDiagnostics).toMatchObject({
      acceptedCount: 3,
      commandCount: 3,
      groupName: '戴帽子的小猫'
    });
    expect(hat?.y).toBeLessThan(face?.y ?? 0);
  });

  it('AI 返回所有部件同坐标时规划层仍会重新排开', () => {
    const plan = planCommands(
      {
        type: 'create_asset_recipe',
        rawText: '画一朵花',
        name: '花',
        recipe: [
          { shape: 'circle', name: '花心', partName: '花蕊', position: { x: 100, y: 100 }, width: 60, height: 60 },
          { shape: 'ellipse', name: '上花瓣', partName: '花瓣', slot: 'top', position: { x: 100, y: 100 }, width: 70, height: 42 },
          { shape: 'ellipse', name: '下花瓣', partName: '花瓣', slot: 'bottom', position: { x: 100, y: 100 }, width: 70, height: 42 },
          { shape: 'ellipse', name: '左花瓣', partName: '花瓣', slot: 'left', position: { x: 100, y: 100 }, width: 70, height: 42 },
          { shape: 'ellipse', name: '右花瓣', partName: '花瓣', slot: 'right', position: { x: 100, y: 100 }, width: 70, height: 42 }
        ]
      },
      createEmptyScene()
    );
    const centers = new Set(plan.commands.map((command) => `${Math.round((command.object?.x ?? 0) + (command.object?.width ?? 0) / 2)}:${Math.round((command.object?.y ?? 0) + (command.object?.height ?? 0) / 2)}`));

    expect(plan.commands).toHaveLength(5);
    expect(centers.size).toBeGreaterThan(3);
  });

  it('AI 素材配方可以附加到已有素材组', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '小猫脸', groupId: 'asset-cat', groupName: '小猫', partId: 'part-face', partName: '脸' })
      }
    ]);
    const plan = planCommands(
      {
        type: 'create_asset_recipe',
        rawText: '给小猫加帽子',
        attachTo: { mode: 'by_group_id', groupId: 'asset-cat', scope: 'group' },
        recipe: [
          { shape: 'rectangle', name: '小猫帽檐', partName: '帽子', color: '#2563eb' },
          { shape: 'rectangle', name: '小猫帽子', partName: '帽子', color: '#2563eb' }
        ]
      },
      scene
    );

    expect(plan.commands).toHaveLength(2);
    expect(plan.commands.map((command) => command.object?.groupId)).toEqual(['asset-cat', 'asset-cat']);
    expect(plan.commands.map((command) => command.object?.groupName)).toEqual(['小猫', '小猫']);
    expect(new Set(plan.commands.map((command) => command.object?.partId)).size).toBe(1);
  });

  it('AI 局部替换会先删除旧部件再附加新配方', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '小猫脸', groupId: 'asset-cat', groupName: '小猫', partId: 'part-face', partName: '脸' })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-2', name: '小猫帽子', groupId: 'asset-cat', groupName: '小猫', partId: 'part-hat', partName: '帽子' })
      }
    ]);
    const plan = planCommands(
      {
        type: 'revise_asset_part',
        rawText: '帽子不好看换一个',
        operation: 'replace',
        selector: { mode: 'by_part_name', name: '帽子', withinGroupName: '小猫', scope: 'part' },
        recipe: [{ shape: 'rectangle', name: '蓝色帽子', partName: '帽子', color: '#2563eb' }]
      },
      scene
    );

    expect(plan.commands[0]).toMatchObject({
      type: 'delete_object',
      selector: { mode: 'by_part_name', name: '帽子', withinGroupName: '小猫', scope: 'part' }
    });
    expect(plan.commands[1].object).toMatchObject({
      groupId: 'asset-cat',
      groupName: '小猫',
      partName: '帽子'
    });
  });

  it('删除局部部件时返回明确的目标反馈', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '小猫脸', groupId: 'asset-cat', groupName: '小猫', partId: 'part-face', partName: '脸' })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-2', name: '小猫帽子', groupId: 'asset-cat', groupName: '小猫', partId: 'part-hat', partName: '帽子' })
      }
    ]);

    const plan = planCommands(parseIntent(transcript('把帽子删掉')), scene);

    expect(plan.commands[0]).toMatchObject({ type: 'delete_object' });
    expect(plan.message).toBe('已删除帽子。');
  });

  it('创建图形时会保留自定义对象名称', () => {
    const single = planCommands(parseIntent(transcript('画一个蓝色圆形叫月亮')), createEmptyScene());
    expect(single.commands[0].object?.name).toBe('月亮');

    const combo = planCommands(parseIntent(transcript('画一个蓝色圆形叫月亮和绿色矩形叫草地')), createEmptyScene());
    expect(combo.commands.map((command) => command.object?.name)).toEqual(['月亮', '草地']);
  });

  it('支持按名称改名、复制和文字编辑', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '月亮', groupId: 'asset-1', groupName: '夜空' })
      },
      {
        type: 'create_object',
        object: createSceneObject('triangle', { id: 'shape-3', name: '月牙', groupId: 'asset-1', groupName: '夜空' })
      },
      {
        type: 'create_object',
        object: createSceneObject('text', { id: 'shape-2', name: '标题', text: '你好' })
      }
    ]);

    const renamePlan = planCommands(parseIntent(transcript('把月亮改名为星星')), scene);
    expect(renamePlan.commands[0]).toMatchObject({
      type: 'update_object',
      updates: { groupName: '星星' }
    });

    const duplicatePlan = planCommands(parseIntent(transcript('复制月亮')), scene);
    expect(duplicatePlan.commands).toHaveLength(3);
    expect(duplicatePlan.commands[0].object?.name).toBe('月亮副本');
    expect(duplicatePlan.commands[1].object?.name).toBe('月牙副本');
    expect(duplicatePlan.commands[0].object?.groupName).toBe('夜空副本');
    expect(duplicatePlan.commands[2]).toMatchObject({ type: 'select_object' });

    const textPlan = planCommands(parseIntent(transcript('把标题文字改成新的标题')), scene);
    expect(textPlan.commands[0]).toMatchObject({
      type: 'update_object',
      updates: { text: '新的标题' }
    });
  });

  it('支持规划成组、取消成组、对齐和均匀分布命令', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '月亮' })
      },
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-2', name: '太阳' })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-3', name: '云朵' })
      }
    ]);

    const groupPlan = planCommands(parseIntent(transcript('把月亮和太阳成组叫夜空')), scene);
    expect(groupPlan.commands[0]).toMatchObject({
      type: 'group_objects',
      selector: { mode: 'by_names', names: ['月亮', '太阳'] },
      groupName: '夜空'
    });

    const groupedScene = applyCommandsAsTransaction(scene, groupPlan.commands);
    const ungroupPlan = planCommands(parseIntent(transcript('取消夜空的分组')), groupedScene);
    expect(ungroupPlan.commands[0]).toMatchObject({
      type: 'ungroup_objects',
      selector: { mode: 'by_name', name: '夜空' }
    });

    const alignPlan = planCommands(parseIntent(transcript('把所有图形左对齐')), scene);
    expect(alignPlan.commands[0]).toMatchObject({ type: 'align_objects', selector: { mode: 'all' }, alignment: 'left' });

    const distributePlan = planCommands(parseIntent(transcript('水平分布所有图形')), scene);
    expect(distributePlan.commands[0]).toMatchObject({ type: 'distribute_objects', selector: { mode: 'all' }, axis: 'horizontal' });
  });

  it('布局类指令目标数量不足时要求澄清', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('circle', { id: 'shape-1', name: '月亮' })
    });

    expect(planCommands(parseIntent(transcript('把所有图形成组')), scene).needsClarification).toBe(true);
    expect(planCommands(parseIntent(transcript('水平分布所有图形')), scene).needsClarification).toBe(true);
  });

  it('目标对象不存在时，按名称编辑会要求澄清', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('circle', { id: 'shape-1', name: '圆形' })
    });
    const intent: DrawingIntent = {
      type: 'update_style',
      rawText: '把太阳改成红色',
      selector: { mode: 'by_name', name: '太阳' },
      color: '#ef4444'
    };

    const plan = planCommands(intent, scene);
    expect(plan.needsClarification).toBe(true);
    expect(plan.commands).toHaveLength(0);
  });

  it('样式指令没有有效修改内容时要求澄清', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('circle', { id: 'shape-1', name: '圆形' })
    });
    const intent: DrawingIntent = {
      type: 'update_style',
      rawText: '把它改成漂亮一点',
      selector: { mode: 'selected' }
    };

    const plan = planCommands(intent, scene);
    expect(plan.needsClarification).toBe(true);
    expect(plan.commands).toHaveLength(0);
    expect(plan.message).toContain('没有识别出要修改的颜色或样式');
  });

  it('目标对象不存在时，图层调整会要求澄清', () => {
    const intent: DrawingIntent = {
      type: 'reorder_object',
      rawText: '把太阳放到最上层',
      selector: { mode: 'by_name', name: '太阳' },
      layer: 'front'
    };

    const plan = planCommands(intent, createEmptyScene());
    expect(plan.needsClarification).toBe(true);
    expect(plan.commands).toHaveLength(0);
  });

  it('复合长句会按临时场景继续规划后续动作', () => {
    const intent = parseIntent(transcript('画一个红色房子和蓝色太阳，再把房子放到最上层'));
    const plan = planCommands(intent, createEmptyScene());
    const fills = plan.commands.map((command) => command.object?.style.fill);

    expect(plan.needsClarification).toBeUndefined();
    expect(plan.commands).toHaveLength(6);
    expect(fills).toContain('#ef4444');
    expect(fills).toContain('#2563eb');
    expect(plan.commands[plan.commands.length - 1]).toMatchObject({
      type: 'reorder_object',
      selector: { mode: 'by_name', name: '房子' },
      layer: 'front'
    });
  });

  it('纯语音查询会生成只读反馈', () => {
    const emptyHelp = planCommands({ type: 'describe_scene', rawText: '画布里有什么' }, createEmptyScene());
    expect(emptyHelp.commands).toHaveLength(0);
    expect(emptyHelp.message).toContain('画布目前是空的');

    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('circle', { id: 'shape-1', name: '红色圆形', fill: '#ef4444', x: 120, y: 80 })
    });
    const scenePlan = planCommands({ type: 'describe_scene', rawText: '画布里有什么' }, scene);
    const selectionPlan = planCommands({ type: 'describe_selection', rawText: '当前选中的是什么' }, scene);

    expect(scenePlan.message).toContain('画布里有 1 个图形：红色圆形');
    expect(selectionPlan.message).toContain('当前选中：红色圆形');
    expect(selectionPlan.message).toContain('颜色 红色');
  });

  it('查询选中对象时优先描述素材组', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-1', name: '房子墙体', groupId: 'asset-house', groupName: '房子' })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-2', name: '房子窗户', groupId: 'asset-house', groupName: '房子' })
      }
    ]);
    const selectedScene = applyCommand(scene, { type: 'select_object', selector: { mode: 'by_name', name: '房子' } });

    const selectionPlan = planCommands({ type: 'describe_selection', rawText: '当前选中的是什么' }, selectedScene);

    expect(selectionPlan.message).toContain('当前选中：房子素材组');
    expect(selectionPlan.message).toContain('包含 2 个部件');
  });
});
