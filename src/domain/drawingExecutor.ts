import { applyCommandsAsTransaction } from './sceneModel';
import { serializeSceneToSvg } from './svgExport';
import type { DrawingCommand, ExecutionResult, SceneState, VoiceTranscript } from './types';

export const executeDrawingCommands = (
  scene: SceneState,
  commands: DrawingCommand[],
  transcript: VoiceTranscript,
  options?: { message?: string; needsClarification?: boolean }
): ExecutionResult => {
  if (options?.needsClarification) {
    return {
      ok: false,
      message: options?.message ?? '需要更多信息才能执行。',
      scene,
      commandsExecuted: 0,
      latencyMs: measureLatency(transcript),
      needsClarification: true
    };
  }

  if (commands.length === 0) {
    return {
      ok: true,
      message: options?.message ?? '已收到语音指令。',
      scene,
      commandsExecuted: 0,
      latencyMs: measureLatency(transcript)
    };
  }

  const hasExport = commands.some((command) => command.type === 'export_canvas');
  const nextScene = applyCommandsAsTransaction(scene, commands);
  const objectCount = nextScene.objects.length;
  const message = options?.message ?? buildMessage(commands, objectCount);

  return {
    ok: true,
    message,
    scene: nextScene,
    commandsExecuted: commands.length,
    latencyMs: measureLatency(transcript),
    exportSvg: hasExport ? serializeSceneToSvg(nextScene) : undefined
  };
};

const buildMessage = (commands: DrawingCommand[], objectCount: number) => {
  if (commands.some((command) => command.type === 'export_canvas')) return '已导出当前画布。';
  if (commands.some((command) => command.type === 'undo')) return '已撤销上一步。';
  if (commands.some((command) => command.type === 'redo')) return '已重做上一步。';
  if (commands.some((command) => command.type === 'clear_canvas')) return '已清空画布。';
  if (commands.length > 1) return `已拆解并执行 ${commands.length} 个绘图步骤。`;
  if (commands.some((command) => command.type === 'select_object')) return '已选择目标图形。';
  if (commands.some((command) => command.type === 'reorder_object')) return '已调整图层顺序。';
  if (commands.some((command) => command.type === 'delete_object')) return '已删除选中的图形。';
  return `已更新画布，现在共有 ${objectCount} 个图形。`;
};

const measureLatency = (transcript: VoiceTranscript) => Math.max(0, Math.round(performance.now() - transcript.receivedAt));
