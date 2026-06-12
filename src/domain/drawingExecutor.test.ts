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
});
