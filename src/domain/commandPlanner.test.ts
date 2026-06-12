import { describe, expect, it, beforeEach } from 'vitest';
import { planCommands, resetCommandIdsForTest } from './commandPlanner';
import { createEmptyScene } from './sceneModel';
import type { DrawingIntent } from './types';

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
});
