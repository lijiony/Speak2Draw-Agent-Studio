import { CANVAS_HEIGHT, CANVAS_WIDTH, createSceneObject, findObject } from './sceneModel';
import type { DrawingCommand, DrawingIntent, SceneState, ShapeKind } from './types';
import { normalizeVoiceText } from './voiceText';

let nextId = 1;

export const resetCommandIdsForTest = () => {
  nextId = 1;
};

export const planCommands = (intent: DrawingIntent, scene: SceneState): { commands: DrawingCommand[]; message?: string; needsClarification?: boolean } => {
  switch (intent.type) {
    case 'clarify':
      return { commands: [], message: intent.reason ?? '请再说一遍。', needsClarification: true };
    case 'unknown':
      return { commands: [], message: intent.reason ?? '暂不支持这条指令。', needsClarification: true };
    case 'create_shape':
      return { commands: [createCommand(intent.shape ?? 'rectangle', intent)] };
    case 'create_complex_scene':
      return { commands: createComplexCommands(intent.rawText) };
    case 'select_object': {
      const target = findObject(scene.objects, intent.selector, scene.selectedId);
      return target
        ? { commands: [{ type: 'select_object', selector: intent.selector }] }
        : { commands: [], message: '没有找到符合条件的图形，请换一种说法。', needsClarification: true };
    }
    case 'update_style': {
      if (!hasEditableTarget(scene)) return noTarget();
      const updates = {
        style: {
          fill: intent.strokeColor ? undefined : intent.color,
          stroke: intent.strokeColor ?? intent.color,
          strokeWidth: intent.strokeWidth
        }
      };
      return { commands: [{ type: 'update_object', selector: intent.selector, updates: compactStyleUpdate(updates) }] };
    }
    case 'move_object':
      return hasEditableTarget(scene) ? { commands: [{ type: 'move_object', selector: intent.selector, direction: intent.direction }] } : noTarget();
    case 'resize_object':
      return hasEditableTarget(scene) ? { commands: [{ type: 'resize_object', selector: intent.selector, scale: intent.scale }] } : noTarget();
    case 'delete_object':
      return hasEditableTarget(scene) ? { commands: [{ type: 'delete_object', selector: intent.selector }] } : noTarget();
    case 'undo':
      return { commands: [{ type: 'undo' }] };
    case 'redo':
      return { commands: [{ type: 'redo' }] };
    case 'clear_canvas':
      return { commands: [{ type: 'clear_canvas' }] };
    case 'export_canvas':
      return { commands: [{ type: 'export_canvas' }] };
    default:
      return { commands: [], message: '暂不支持这条指令。', needsClarification: true };
  }
};

const createCommand = (shape: ShapeKind, intent: DrawingIntent): DrawingCommand => ({
  type: 'create_object',
  object: createSceneObject(shape, {
    id: createId(),
    x: intent.position?.x,
    y: intent.position?.y,
    fill: intent.color,
    stroke: shape === 'line' ? intent.color ?? '#111827' : '#111827',
    text: intent.text
  })
});

const createComplexCommands = (rawText: string): DrawingCommand[] => {
  const text = normalizeVoiceText(rawText);
  const commands: DrawingCommand[] = [];

  if (text.includes('房子')) {
    commands.push(
      objectCommand('rectangle', { name: '房子墙体', x: 340, y: 300, width: 220, height: 160, fill: '#fef3c7' }),
      objectCommand('triangle', { name: '房子屋顶', x: 310, y: 200, width: 280, height: 130, fill: '#ef4444' }),
      objectCommand('rectangle', { name: '房子门', x: 425, y: 370, width: 50, height: 90, fill: '#92400e' }),
      objectCommand('rectangle', { name: '房子窗户', x: 365, y: 335, width: 48, height: 42, fill: '#bfdbfe' })
    );
  }

  if (text.includes('太阳')) {
    commands.push(objectCommand('circle', { name: '太阳', x: 710, y: 70, width: 100, height: 100, fill: '#facc15', stroke: '#f97316' }));
  }

  if (text.includes('树')) {
    commands.push(
      objectCommand('rectangle', { name: '树干', x: 150, y: 370, width: 42, height: 110, fill: '#92400e' }),
      objectCommand('circle', { name: '树冠', x: 112, y: 280, width: 120, height: 120, fill: '#16a34a' })
    );
  }

  if (text.includes('机器人')) {
    commands.push(
      objectCommand('rectangle', { name: '机器人身体', x: 610, y: 310, width: 150, height: 150, fill: '#d1d5db' }),
      objectCommand('rectangle', { name: '机器人头部', x: 635, y: 210, width: 100, height: 80, fill: '#e5e7eb' }),
      objectCommand('circle', { name: '机器人左眼', x: 660, y: 238, width: 18, height: 18, fill: '#111827' }),
      objectCommand('circle', { name: '机器人右眼', x: 698, y: 238, width: 18, height: 18, fill: '#111827' })
    );
  }

  if (commands.length > 0) return commands;

  return [
    objectCommand('circle', { name: '圆形', x: CANVAS_WIDTH / 2 - 150, y: CANVAS_HEIGHT / 2 - 80, fill: '#60a5fa' }),
    objectCommand('rectangle', { name: '矩形', x: CANVAS_WIDTH / 2 + 20, y: CANVAS_HEIGHT / 2 - 70, fill: '#f97316' })
  ];
};

const objectCommand = (
  shape: ShapeKind,
  options: Omit<Parameters<typeof createSceneObject>[1], 'id'>
): DrawingCommand => ({
  type: 'create_object',
  object: createSceneObject(shape, { id: createId(), ...options })
});

const hasEditableTarget = (scene: SceneState) => Boolean(scene.objects.length);

const noTarget = () => ({
  commands: [],
  message: '当前没有可编辑的图形，请先说“画一个圆形”之类的指令。',
  needsClarification: true
});

const compactStyleUpdate = (updates: { style: { fill?: string; stroke?: string; strokeWidth?: number } }) => ({
  style: Object.fromEntries(Object.entries(updates.style).filter(([, value]) => value !== undefined)) as {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }
});

const createId = () => `shape-${nextId++}`;
