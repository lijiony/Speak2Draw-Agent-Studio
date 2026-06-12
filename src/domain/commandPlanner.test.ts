import { describe, expect, it, beforeEach } from 'vitest';
import { planCommands, resetCommandIdsForTest } from './commandPlanner';
import { parseIntent } from './intentParser';
import { applyCommand, createEmptyScene, createSceneObject } from './sceneModel';
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
});
