import { describe, expect, it } from 'vitest';
import { planCommands, resetCommandIdsForTest } from './commandPlanner';
import { executeDrawingCommands } from './drawingExecutor';
import { parseIntent } from './intentParser';
import { createEmptyScene } from './sceneModel';
import type { VoiceTranscript } from './types';

const transcript = (text: string): VoiceTranscript => ({
  text,
  confidence: 0.95,
  receivedAt: performance.now(),
  isFinal: true
});

describe('voice drawing flow', () => {
  it('从语音文本到画布对象完成完整链路', () => {
    resetCommandIdsForTest();
    const input = transcript('画一个红色圆形');
    const intent = parseIntent(input);
    const plan = planCommands(intent, createEmptyScene());
    const result = executeDrawingCommands(createEmptyScene(), plan.commands, input, plan);

    expect(result.ok).toBe(true);
    expect(result.scene.objects).toHaveLength(1);
    expect(result.scene.objects[0].kind).toBe('circle');
    expect(result.scene.objects[0].style.fill).toBe('#ef4444');
  });

  it('按对象名称修改复杂场景中的目标图形', () => {
    resetCommandIdsForTest();
    const createInput = transcript('画一个房子和太阳');
    const createIntent = parseIntent(createInput);
    const createPlan = planCommands(createIntent, createEmptyScene());
    const created = executeDrawingCommands(createEmptyScene(), createPlan.commands, createInput, createPlan);

    const updateInput = transcript('把太阳改成红色');
    const updateIntent = parseIntent(updateInput);
    const updatePlan = planCommands(updateIntent, created.scene);
    const updated = executeDrawingCommands(created.scene, updatePlan.commands, updateInput, updatePlan);
    const sun = updated.scene.objects.find((object) => object.name === '太阳');

    expect(updated.ok).toBe(true);
    expect(sun?.style.fill).toBe('#ef4444');
    expect(updated.scene.objects.filter((object) => object.name.includes('房子'))).toHaveLength(4);
  });

  it('按对象名称调整图层顺序', () => {
    resetCommandIdsForTest();
    const createInput = transcript('画一个房子和太阳');
    const created = executeDrawingCommands(
      createEmptyScene(),
      planCommands(parseIntent(createInput), createEmptyScene()).commands,
      createInput
    );

    const layerInput = transcript('把房子放到最上层');
    const plan = planCommands(parseIntent(layerInput), created.scene);
    const layered = executeDrawingCommands(created.scene, plan.commands, layerInput, plan);

    expect(layered.ok).toBe(true);
    expect(layered.message).toBe('已调整图层顺序。');
    expect(layered.scene.objects[layered.scene.objects.length - 1]?.name).toContain('房子');
  });
});
