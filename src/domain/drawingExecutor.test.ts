import { describe, expect, it } from 'vitest';
import { planCommands, resetCommandIdsForTest } from './commandPlanner';
import { executeDrawingCommands } from './drawingExecutor';
import { parseIntent } from './intentParser';
import { applyCommandsAsTransaction, createEmptyScene, createSceneObject } from './sceneModel';
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

  it('执行普通多图形组合语音指令', () => {
    resetCommandIdsForTest();
    const input = transcript('画一个蓝色圆形和绿色矩形');
    const plan = planCommands(parseIntent(input), createEmptyScene());
    const result = executeDrawingCommands(createEmptyScene(), plan.commands, input, plan);

    expect(result.ok).toBe(true);
    expect(result.message).toBe('已拆解并执行 2 个绘图步骤。');
    expect(result.scene.objects).toHaveLength(2);
    expect(result.scene.objects.map((object) => object.kind)).toEqual(['circle', 'rectangle']);
    expect(result.scene.objects.map((object) => object.style.fill)).toEqual(['#2563eb', '#16a34a']);
  });

  it('支持创建后按自定义名称编辑对象', () => {
    resetCommandIdsForTest();
    const createInput = transcript('画一个蓝色圆形叫月亮');
    const created = executeDrawingCommands(
      createEmptyScene(),
      planCommands(parseIntent(createInput), createEmptyScene()).commands,
      createInput
    );

    const updateInput = transcript('把月亮改成红色');
    const updatePlan = planCommands(parseIntent(updateInput), created.scene);
    const updated = executeDrawingCommands(created.scene, updatePlan.commands, updateInput, updatePlan);

    expect(created.scene.objects[0].name).toBe('月亮');
    expect(updated.ok).toBe(true);
    expect(updated.scene.objects[0].name).toBe('月亮');
    expect(updated.scene.objects[0].style.fill).toBe('#ef4444');
  });

  it('支持创建后按自定义名称移动对象', () => {
    resetCommandIdsForTest();
    const createInput = transcript('画一个蓝色圆形叫月亮');
    const created = executeDrawingCommands(
      createEmptyScene(),
      planCommands(parseIntent(createInput), createEmptyScene()).commands,
      createInput
    );

    const moveInput = transcript('把月亮向右移动一点');
    const movePlan = planCommands(parseIntent(moveInput), created.scene);
    const moved = executeDrawingCommands(created.scene, movePlan.commands, moveInput, movePlan);

    expect(moved.ok).toBe(true);
    expect(moved.scene.objects[0].name).toBe('月亮');
    expect(moved.scene.objects[0].x).toBeGreaterThan(created.scene.objects[0].x);
  });

  it('支持复制整组素材并保留新的组名', () => {
    resetCommandIdsForTest();
    const createdScene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '猫脸', groupId: 'asset-1', groupName: '猫', x: 320, y: 210 })
      },
      {
        type: 'create_object',
        object: createSceneObject('triangle', { id: 'shape-2', name: '猫左耳', groupId: 'asset-1', groupName: '猫', x: 310, y: 170 })
      },
      {
        type: 'create_object',
        object: createSceneObject('triangle', { id: 'shape-3', name: '猫右耳', groupId: 'asset-1', groupName: '猫', x: 420, y: 170 })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-4', name: '猫帽子', groupId: 'asset-1', groupName: '猫', x: 350, y: 180 })
      }
    ]);

    const copyInput = transcript('复制猫');
    const copyPlan = planCommands(parseIntent(copyInput), createdScene);
    const duplicated = executeDrawingCommands(createdScene, copyPlan.commands, copyInput, copyPlan);

    expect(duplicated.ok).toBe(true);
    expect(duplicated.scene.objects).toHaveLength(8);
    expect(duplicated.scene.objects.filter((object) => object.groupName === '猫副本')).toHaveLength(4);
    expect(duplicated.message).toContain('已复制并创建 4 个图形。');
  });

  it('支持把文字对象改成新的内容', () => {
    resetCommandIdsForTest();
    const createInput = transcript('写文字你好');
    const created = executeDrawingCommands(
      createEmptyScene(),
      planCommands(parseIntent(createInput), createEmptyScene()).commands,
      createInput
    );

    const updateInput = transcript('把文字改成世界');
    const updatePlan = planCommands(parseIntent(updateInput), created.scene);
    const updated = executeDrawingCommands(created.scene, updatePlan.commands, updateInput, updatePlan);

    expect(updated.ok).toBe(true);
    expect(updated.scene.objects[0].kind).toBe('text');
    expect(updated.scene.objects[0].text).toBe('世界');
    expect(updated.message).toBe('已更新文字内容。');
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

  it('执行复合长句时会拆解创建和图层动作', () => {
    resetCommandIdsForTest();
    const input = transcript('画一个红色房子和蓝色太阳，再把房子放到最上层');
    const intent = parseIntent(input);
    const plan = planCommands(intent, createEmptyScene());
    const result = executeDrawingCommands(createEmptyScene(), plan.commands, input, plan);
    const sun = result.scene.objects.find((object) => object.name === '太阳');

    expect(result.ok).toBe(true);
    expect(result.message).toBe('已拆解并执行 6 个绘图步骤。');
    expect(result.commandsExecuted).toBe(6);
    expect(result.scene.objects).toHaveLength(5);
    expect(sun?.style.fill).toBe('#2563eb');
    expect(result.scene.objects[result.scene.objects.length - 1]?.name).toContain('房子');
  });

  it('撤销和重做会按整条复杂语音命令回退', () => {
    resetCommandIdsForTest();
    const createInput = transcript('画一个房子和太阳');
    const createPlan = planCommands(parseIntent(createInput), createEmptyScene());
    const created = executeDrawingCommands(createEmptyScene(), createPlan.commands, createInput, createPlan);

    const undoInput = transcript('撤销');
    const undoPlan = planCommands(parseIntent(undoInput), created.scene);
    const undone = executeDrawingCommands(created.scene, undoPlan.commands, undoInput, undoPlan);

    const redoInput = transcript('重做');
    const redoPlan = planCommands(parseIntent(redoInput), undone.scene);
    const redone = executeDrawingCommands(undone.scene, redoPlan.commands, redoInput, redoPlan);

    expect(created.scene.objects).toHaveLength(5);
    expect(undone.scene.objects).toHaveLength(0);
    expect(redone.scene.objects).toHaveLength(5);
    expect(redone.scene.objects.map((object) => object.name)).toContain('太阳');
  });

  it('执行只读语音查询时不修改画布', () => {
    const scene = createEmptyScene();
    const input = transcript('我能说什么');
    const plan = planCommands(parseIntent(input), scene);
    const result = executeDrawingCommands(scene, plan.commands, input, plan);

    expect(result.ok).toBe(true);
    expect(result.commandsExecuted).toBe(0);
    expect(result.scene).toBe(scene);
    expect(result.message).toContain('可以说');
  });

  it('无有效样式内容时不会误报执行成功', () => {
    resetCommandIdsForTest();
    const createInput = transcript('画一个蓝色圆形');
    const createPlan = planCommands(parseIntent(createInput), createEmptyScene());
    const created = executeDrawingCommands(createEmptyScene(), createPlan.commands, createInput, createPlan);

    const unclearInput = transcript('把它改成漂亮一点');
    const unclearPlan = planCommands(parseIntent(unclearInput), created.scene);
    const result = executeDrawingCommands(created.scene, unclearPlan.commands, unclearInput, unclearPlan);

    expect(result.ok).toBe(false);
    expect(result.needsClarification).toBe(true);
    expect(result.commandsExecuted).toBe(0);
    expect(result.scene).toBe(created.scene);
    expect(result.message).toContain('没有识别出要修改的颜色或样式');
  });
});
