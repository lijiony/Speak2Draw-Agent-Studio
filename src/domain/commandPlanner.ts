import { applyCommands, CANVAS_HEIGHT, CANVAS_WIDTH, createSceneObject, findObject } from './sceneModel';
import type { DrawingCommand, DrawingIntent, SceneState, ShapeKind } from './types';
import { normalizeVoiceText } from './voiceText';
import { detectColor, detectShape } from './intentParser';

let nextId = 1;

export const resetCommandIdsForTest = () => {
  nextId = 1;
};

export const planCommands = (intent: DrawingIntent, scene: SceneState): { commands: DrawingCommand[]; message?: string; needsClarification?: boolean } => {
  switch (intent.type) {
    case 'sequence':
      return planSequenceCommands(intent.intents ?? [], scene);
    case 'help':
      return { commands: [], message: HELP_MESSAGE };
    case 'describe_scene':
      return { commands: [], message: describeScene(scene) };
    case 'describe_selection':
      return { commands: [], message: describeSelection(scene) };
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
      if (!hasEditableTarget(scene, intent.selector)) return noTarget();
      const updates = {
        style: {
          fill: intent.strokeColor ? undefined : intent.color,
          stroke: intent.strokeColor ?? intent.color,
          strokeWidth: intent.strokeWidth
        }
      };
      const styleUpdate = compactStyleUpdate(updates);
      if (!hasStyleUpdate(styleUpdate)) {
        return {
          commands: [],
          message: '没有识别出要修改的颜色或样式，请说“把它改成黄色”或“线条加粗”。',
          needsClarification: true
        };
      }
      return { commands: [{ type: 'update_object', selector: intent.selector, updates: styleUpdate }] };
    }
    case 'move_object':
      return hasEditableTarget(scene, intent.selector) ? { commands: [{ type: 'move_object', selector: intent.selector, direction: intent.direction }] } : noTarget();
    case 'resize_object':
      return hasEditableTarget(scene, intent.selector) ? { commands: [{ type: 'resize_object', selector: intent.selector, scale: intent.scale }] } : noTarget();
    case 'reorder_object':
      return hasEditableTarget(scene, intent.selector) ? { commands: [{ type: 'reorder_object', selector: intent.selector, layer: intent.layer }] } : noTarget();
    case 'delete_object':
      return hasEditableTarget(scene, intent.selector) ? { commands: [{ type: 'delete_object', selector: intent.selector }] } : noTarget();
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
    name: intent.name,
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
  const houseColor = detectEntityColor(text, '房子');
  const sunColor = detectEntityColor(text, '太阳');

  if (text.includes('房子')) {
    commands.push(
      objectCommand('rectangle', { name: '房子墙体', x: 340, y: 300, width: 220, height: 160, fill: houseColor ?? '#fef3c7' }),
      objectCommand('triangle', { name: '房子屋顶', x: 310, y: 200, width: 280, height: 130, fill: houseColor ?? '#ef4444' }),
      objectCommand('rectangle', { name: '房子门', x: 425, y: 370, width: 50, height: 90, fill: '#92400e' }),
      objectCommand('rectangle', { name: '房子窗户', x: 365, y: 335, width: 48, height: 42, fill: '#bfdbfe' })
    );
  }

  if (text.includes('太阳')) {
    commands.push(objectCommand('circle', { name: '太阳', x: 710, y: 70, width: 100, height: 100, fill: sunColor ?? '#facc15', stroke: '#f97316' }));
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

  const genericShapeCommands = createGenericShapeCommands(text);
  if (genericShapeCommands.length > 0) return genericShapeCommands;

  return [
    objectCommand('circle', { name: '圆形', x: CANVAS_WIDTH / 2 - 150, y: CANVAS_HEIGHT / 2 - 80, fill: '#60a5fa' }),
    objectCommand('rectangle', { name: '矩形', x: CANVAS_WIDTH / 2 + 20, y: CANVAS_HEIGHT / 2 - 70, fill: '#f97316' })
  ];
};

const planSequenceCommands = (
  intents: DrawingIntent[],
  scene: SceneState
): { commands: DrawingCommand[]; message?: string; needsClarification?: boolean } => {
  const commands: DrawingCommand[] = [];
  let draftScene = scene;

  for (const intent of intents) {
    const plan = planCommands(intent, draftScene);
    if (plan.needsClarification) {
      return {
        commands: [],
        message: plan.message ?? '复合指令中有一步需要更多信息，请拆开重说。',
        needsClarification: true
      };
    }
    commands.push(...plan.commands);
    draftScene = applyCommands(draftScene, plan.commands);
  }

  return { commands };
};

const objectCommand = (
  shape: ShapeKind,
  options: Omit<Parameters<typeof createSceneObject>[1], 'id'>
): DrawingCommand => ({
  type: 'create_object',
  object: createSceneObject(shape, { id: createId(), ...options })
});

const createGenericShapeCommands = (text: string): DrawingCommand[] => {
  const items = splitShapeItems(text)
    .map((segment) => ({
      segment,
      shape: detectShape(segment)
    }))
    .filter((item): item is { segment: string; shape: ShapeKind } => Boolean(item.shape));

  return items.map((item, index) => {
    const position = genericShapePosition(index, items.length, item.shape);
    const color = detectColor(item.segment);
    return objectCommand(item.shape, {
      name: detectCustomName(item.segment) ?? shapeLabel(item.shape),
      x: position.x,
      y: position.y,
      fill: item.shape === 'line' ? 'none' : color,
      stroke: item.shape === 'line' ? color ?? '#111827' : '#111827',
      text: item.shape === 'text' ? '文字' : undefined
    });
  });
};

const splitShapeItems = (text: string) =>
  text
    .replace(/^(画|添加|创建|绘制|生成|来一个)+/, '')
    .split(/和|还有|同时|一起|加上/)
    .map((segment) => segment.trim())
    .filter(Boolean);

const genericShapePosition = (index: number, total: number, shape: ShapeKind) => {
  const spacing = 190;
  const size = shape === 'line' ? { width: 180, height: 8 } : shape === 'triangle' ? { width: 150, height: 130 } : { width: 140, height: 100 };
  const startX = CANVAS_WIDTH / 2 - ((total - 1) * spacing) / 2 - size.width / 2;
  return {
    x: clamp(startX + index * spacing, 48, CANVAS_WIDTH - size.width - 48),
    y: CANVAS_HEIGHT / 2 - size.height / 2
  };
};

const shapeLabel = (shape: ShapeKind) => {
  const labels: Record<ShapeKind, string> = {
    circle: '圆形',
    rectangle: '矩形',
    ellipse: '椭圆',
    line: '线条',
    triangle: '三角形',
    text: '文字'
  };
  return labels[shape];
};

const detectCustomName = (text: string) => {
  const match = text.match(/(?:叫|命名为|名字叫|名称叫)([^，。,.、\s]+)/);
  const name = match?.[1]?.trim();
  return name || undefined;
};

const hasEditableTarget = (scene: SceneState, selector: DrawingIntent['selector']) =>
  Boolean(findObject(scene.objects, selector ?? { mode: 'selected' }, scene.selectedId));

const HELP_MESSAGE =
  '可以说：画一个红色圆形、画一个房子和太阳、选择太阳、把它改成黄色、向右移动一点、撤销、导出图片，或问我画布里有什么。';

const describeScene = (scene: SceneState) => {
  if (scene.objects.length === 0) return '画布目前是空的。可以先说“画一个红色圆形”。';
  const names = scene.objects.map((object) => object.name);
  const visibleNames = names.slice(0, 6).join('、');
  const countText = names.length > 6 ? `${names.length} 个图形，其中包括` : `${names.length} 个图形`;
  const selected = scene.selectedId ? scene.objects.find((object) => object.id === scene.selectedId)?.name : null;
  return `画布里有 ${countText}：${visibleNames}。当前选中：${selected ?? '无'}。`;
};

const describeSelection = (scene: SceneState) => {
  const selected = scene.selectedId ? scene.objects.find((object) => object.id === scene.selectedId) : null;
  if (!selected) return '当前没有明确选中图形。可以说“选择最后一个图形”。';
  return `当前选中：${selected.name}，颜色 ${colorLabel(selected.style.fill)}，位置 ${Math.round(selected.x)}、${Math.round(selected.y)}。`;
};

const colorLabel = (color: string) => {
  const labels: Record<string, string> = {
    '#ef4444': '红色',
    '#2563eb': '蓝色',
    '#16a34a': '绿色',
    '#facc15': '黄色',
    '#111827': '黑色',
    '#ffffff': '白色',
    '#7c3aed': '紫色',
    '#f97316': '橙色',
    '#6b7280': '灰色',
    '#ec4899': '粉色',
    '#fef3c7': '浅黄色',
    '#92400e': '棕色',
    '#bfdbfe': '浅蓝色',
    '#d1d5db': '浅灰色',
    '#e5e7eb': '浅灰色'
  };
  return labels[color] ?? color;
};

const detectEntityColor = (text: string, entity: string) => {
  const entityIndex = text.indexOf(entity);
  if (entityIndex < 0) return undefined;
  const prefix = text.slice(0, entityIndex + entity.length);
  const segments = prefix.split(/和|还有|同时|一起|加上|然后|接着|随后|并且|再/);
  const segment = segments[segments.length - 1] ?? prefix;
  return detectColor(segment);
};

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

const hasStyleUpdate = (updates: ReturnType<typeof compactStyleUpdate>) => Object.keys(updates.style).length > 0;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const createId = () => `shape-${nextId++}`;
