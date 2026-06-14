import { applyCommands, CANVAS_HEIGHT, CANVAS_WIDTH, createSceneObject, findObject, findObjects } from './sceneModel';
import { layoutAssetRecipe } from './assetRecipeLayout';
import type { DrawingCommand, DrawingIntent, LayoutDiagnostics, PrimitiveShapeKind, SceneObject, SceneState, SvgArtworkDiagnostics } from './types';
import { normalizeVoiceText } from './voiceText';
import { detectColor, detectShape } from './intentParser';

let nextId = 1;

export const resetCommandIdsForTest = () => {
  nextId = 1;
};

export type DrawingCommandPlan = {
  commands: DrawingCommand[];
  message?: string;
  needsClarification?: boolean;
  layoutDiagnostics?: LayoutDiagnostics;
  svgArtworkDiagnostics?: SvgArtworkDiagnostics;
};

export const planCommands = (intent: DrawingIntent, scene: SceneState): DrawingCommandPlan => {
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
    case 'create_asset_recipe': {
      const recipePlan = createAssetRecipePlan(intent, scene);
      return recipePlan.commands.length
        ? recipePlan
        : { commands: [], message: 'AI 没有生成可安全执行的绘图配方，请换一种说法。', needsClarification: true };
    }
    case 'revise_asset_part': {
      const target = findObject(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (!target) return noTarget('没有找到要修改的局部，请先说“选择房子的窗户”或“选择帽子”。');
      const partSelector = intent.selector ? { ...intent.selector, scope: 'part' as const } : { mode: 'selected' as const, scope: 'part' as const };
      if (intent.operation === 'delete' || !intent.recipe?.length) {
        return {
          commands: [{ type: 'delete_object', selector: partSelector }],
          message: `已删除${target.partName ?? target.name}。`
        };
      }
      const attachTo = target.groupId ? { mode: 'by_group_id' as const, groupId: target.groupId, scope: 'group' as const } : intent.attachTo;
      const recipePlan = createAssetRecipePlan({ ...intent, type: 'create_asset_recipe', attachTo }, scene, target);
      return recipePlan.commands.length
        ? {
            commands: [{ type: 'delete_object', selector: partSelector }, ...recipePlan.commands],
            message: `已替换${target.partName ?? target.name}。`,
            layoutDiagnostics: recipePlan.layoutDiagnostics
          }
        : { commands: [], message: 'AI 没有生成可替换的安全部件。', needsClarification: true };
    }
    case 'rename_object': {
      const target = findObject(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (!target) return noTarget('当前没有可重命名的图形，请先画出一个对象。');
      if (!intent.name) return { commands: [], message: '没有识别出新的名称，请再说一遍。', needsClarification: true };

      const updates = target.groupId ? { groupName: intent.name } : { name: intent.name };
      return {
        commands: [{ type: 'update_object', selector: intent.selector, updates }],
        message: target.groupId ? '已重命名素材组。' : '已重命名目标图形。'
      };
    }
    case 'update_text': {
      const target = findObject(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (!target) return noTarget('当前没有可编辑文字的图形，请先画出一个文字对象。');
      if (target.kind !== 'text') {
        return {
          commands: [],
          message: '当前目标不是文字对象，请先说“写文字你好”创建文本。',
          needsClarification: true
        };
      }
      if (!intent.text) return { commands: [], message: '没有识别出新的文字内容，请再说一遍。', needsClarification: true };

      return {
        commands: [{ type: 'update_object', selector: intent.selector, updates: { text: intent.text } }],
        message: '已更新文字内容。'
      };
    }
    case 'duplicate_object': {
      const target = findObject(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (!target) return noTarget('当前没有可复制的图形，请先画出一个对象。');
      const relatedObjects = target.groupId ? scene.objects.filter((object) => object.groupId === target.groupId) : [target];
      const copyName = duplicateLabel(target.groupName ?? target.name);
      const newGroupId = relatedObjects.length > 1 ? createGroupId() : undefined;
      const commands = relatedObjects.map((object) => {
        const commonOptions = {
          name: duplicateLabel(object.name),
          groupId: newGroupId,
          groupName: copyName,
          x: clamp(object.x + 32, 0, CANVAS_WIDTH - object.width),
          y: clamp(object.y + 32, 0, CANVAS_HEIGHT - object.height),
          width: object.width,
          height: object.height,
          fill: object.style.fill,
          stroke: object.style.stroke,
          strokeWidth: object.style.strokeWidth,
          text: object.text
        };
        return object.kind === 'svg_artwork'
          ? {
              type: 'create_object' as const,
              object: createSceneObject('svg_artwork', {
                id: createId(),
                ...commonOptions,
                svgArtwork: object.svgArtwork
              })
            }
          : objectCommand(object.kind, commonOptions);
      });
      commands.push({ type: 'select_object', selector: { mode: 'by_name', name: copyName } });
      return {
        commands,
        message:
          relatedObjects.length > 1
            ? `已复制并创建 ${relatedObjects.length} 个图形。`
            : '已复制目标图形。'
        };
    }
    case 'group_objects': {
      const targets = findObjects(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (targets.length < 2) {
        return {
          commands: [],
          message: '至少需要两个图形才能成组，请先画出多个对象或说“把所有图形成组”。',
          needsClarification: true
        };
      }
      const groupName = intent.name ?? inferGroupName(intent.rawText, targets);
      return {
        commands: [
          {
            type: 'group_objects',
            selector: intent.selector,
            groupId: createGroupId(),
            groupName
          }
        ],
        message: `已将 ${targets.length} 个图形成组为${groupName}。`
      };
    }
    case 'ungroup_objects': {
      const targets = findObjects(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (targets.length === 0) return noTarget('当前没有可取消成组的图形。');
      if (!targets.some((object) => object.groupId)) {
        return { commands: [], message: '当前目标还没有成组。', needsClarification: true };
      }
      return {
        commands: [{ type: 'ungroup_objects', selector: intent.selector }],
        message: '已取消目标素材组。'
      };
    }
    case 'align_objects': {
      const targets = findObjects(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (targets.length < 2) {
        return { commands: [], message: '至少需要两个图形才能对齐。', needsClarification: true };
      }
      return {
        commands: [{ type: 'align_objects', selector: intent.selector, alignment: intent.alignment }],
        message: '已对齐目标图形。'
      };
    }
    case 'distribute_objects': {
      const targets = findObjects(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (targets.length < 3) {
        return { commands: [], message: '至少需要三个图形才能均匀分布。', needsClarification: true };
      }
      return {
        commands: [{ type: 'distribute_objects', selector: intent.selector, axis: intent.axis }],
        message: '已均匀分布目标图形。'
      };
    }
    case 'select_object': {
      const target = findObject(scene.objects, intent.selector, scene.selectedId, scene.selection);
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
    case 'delete_object': {
      const target = findObject(scene.objects, intent.selector, scene.selectedId, scene.selection);
      if (!target) return noTarget();
      const targetLabel = intent.selector?.scope === 'part' && intent.selector.name ? intent.selector.name : target.partName ?? target.groupName ?? target.name;
      return {
        commands: [{ type: 'delete_object', selector: intent.selector }],
        message: `已删除${targetLabel}。`
      };
    }
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

const createCommand = (shape: PrimitiveShapeKind, intent: DrawingIntent): DrawingCommand => ({
  type: 'create_object',
  object: createSceneObject(shape, {
    id: createId(),
    name: intent.name,
    x: intent.position?.x,
    y: intent.position?.y,
    width: intent.width,
    height: intent.height,
    fill: intent.color,
    stroke: shape === 'line' ? intent.color ?? '#111827' : '#111827',
    text: intent.text
  })
});

const createAssetRecipePlan = (intent: DrawingIntent, scene: SceneState, placementTarget?: SceneObject): DrawingCommandPlan => {
  const recipe = (intent.recipe ?? []).slice(0, 16);
  const attachedTarget = intent.attachTo ? findObject(scene.objects, intent.attachTo, scene.selectedId, scene.selection) : undefined;
  const attachedGroup = attachedTarget?.groupId
    ? {
        groupId: attachedTarget.groupId,
        groupName: attachedTarget.groupName ?? intent.name ?? inferAssetGroupName(intent.rawText, recipe)
      }
    : null;
  const groupName = attachedGroup?.groupName ?? intent.name ?? inferAssetGroupName(intent.rawText, recipe);
  const groupId = attachedGroup?.groupId ?? (groupName ? createGroupId() : undefined);
  const partIdsByName = new Map<string, string>();
  const layout = layoutAssetRecipe({
    recipe,
    scene,
    groupName,
    groupId,
    placementTarget: placementTarget ?? attachedTarget,
    transcript: intent.rawText
  });

  const commands = layout.items.map((layoutItem, index) =>
    objectCommand(layoutItem.item.shape, {
      name: layoutItem.item.name ?? (groupName ? `${groupName}部件${index + 1}` : undefined),
      groupId,
      groupName,
      partName: layoutItem.item.partName,
      partId: layoutItem.item.partName ? partIdForName(partIdsByName, layoutItem.item.partName) : undefined,
      x: layoutItem.x,
      y: layoutItem.y,
      width: layoutItem.width,
      height: layoutItem.height,
      fill: layoutItem.item.shape === 'line' ? 'none' : layoutItem.item.color,
      stroke: layoutItem.item.strokeColor ?? (layoutItem.item.shape === 'line' ? layoutItem.item.color ?? '#111827' : '#111827'),
      strokeWidth: layoutItem.item.strokeWidth,
      text: layoutItem.item.text
    })
  );

  return {
    commands,
    layoutDiagnostics: {
      ...layout.diagnostics,
      commandCount: commands.length
    }
  };
};

const createComplexCommands = (rawText: string): DrawingCommand[] => {
  const text = normalizeVoiceText(rawText);
  const commands: DrawingCommand[] = [];
  const houseColor = detectEntityColor(text, '房子');
  const sunColor = detectEntityColor(text, '太阳');

  if (text.includes('房子')) {
    const houseGroupId = createGroupId();
    commands.push(
      objectCommand('rectangle', { name: '房子墙体', groupId: houseGroupId, groupName: '房子', partId: createPartId(), partName: '墙体', x: 340, y: 300, width: 220, height: 160, fill: houseColor ?? '#fef3c7' }),
      objectCommand('triangle', { name: '房子屋顶', groupId: houseGroupId, groupName: '房子', partId: createPartId(), partName: '屋顶', x: 310, y: 200, width: 280, height: 130, fill: houseColor ?? '#ef4444' }),
      objectCommand('rectangle', { name: '房子门', groupId: houseGroupId, groupName: '房子', partId: createPartId(), partName: '门', x: 425, y: 370, width: 50, height: 90, fill: '#92400e' }),
      objectCommand('rectangle', { name: '房子窗户', groupId: houseGroupId, groupName: '房子', partId: createPartId(), partName: '窗户', x: 365, y: 335, width: 48, height: 42, fill: '#bfdbfe' })
    );
  }

  if (text.includes('太阳')) {
    commands.push(objectCommand('circle', { name: '太阳', x: 710, y: 70, width: 100, height: 100, fill: sunColor ?? '#facc15', stroke: '#f97316' }));
  }

  if (text.includes('树')) {
    const treeGroupId = createGroupId();
    commands.push(
      objectCommand('rectangle', { name: '树干', groupId: treeGroupId, groupName: '树', x: 150, y: 370, width: 42, height: 110, fill: '#92400e' }),
      objectCommand('circle', { name: '树冠', groupId: treeGroupId, groupName: '树', x: 112, y: 280, width: 120, height: 120, fill: '#16a34a' })
    );
  }

  if (text.includes('机器人')) {
    const robotGroupId = createGroupId();
    commands.push(
      objectCommand('rectangle', { name: '机器人身体', groupId: robotGroupId, groupName: '机器人', x: 610, y: 310, width: 150, height: 150, fill: '#d1d5db' }),
      objectCommand('rectangle', { name: '机器人头部', groupId: robotGroupId, groupName: '机器人', x: 635, y: 210, width: 100, height: 80, fill: '#e5e7eb' }),
      objectCommand('circle', { name: '机器人左眼', groupId: robotGroupId, groupName: '机器人', x: 660, y: 238, width: 18, height: 18, fill: '#111827' }),
      objectCommand('circle', { name: '机器人右眼', groupId: robotGroupId, groupName: '机器人', x: 698, y: 238, width: 18, height: 18, fill: '#111827' })
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
): DrawingCommandPlan => {
  const commands: DrawingCommand[] = [];
  let draftScene = scene;
  let layoutDiagnostics: LayoutDiagnostics | undefined;

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
    layoutDiagnostics = plan.layoutDiagnostics ?? layoutDiagnostics;
    draftScene = applyCommands(draftScene, plan.commands);
  }

  return { commands, layoutDiagnostics };
};

const objectCommand = (
  shape: PrimitiveShapeKind,
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
    .filter((item): item is { segment: string; shape: PrimitiveShapeKind } => Boolean(item.shape));

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

const genericShapePosition = (index: number, total: number, shape: PrimitiveShapeKind) => {
  const spacing = 190;
  const size = shape === 'line' ? { width: 180, height: 8 } : shape === 'triangle' ? { width: 150, height: 130 } : { width: 140, height: 100 };
  const startX = CANVAS_WIDTH / 2 - ((total - 1) * spacing) / 2 - size.width / 2;
  return {
    x: clamp(startX + index * spacing, 48, CANVAS_WIDTH - size.width - 48),
    y: CANVAS_HEIGHT / 2 - size.height / 2
  };
};

const shapeLabel = (shape: PrimitiveShapeKind) => {
  const labels: Record<PrimitiveShapeKind, string> = {
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

const inferAssetGroupName = (rawText: string, recipe: Array<{ name?: string }>) => {
  const textName = normalizeVoiceText(rawText)
    .replace(/^(画|添加|创建|绘制|生成|来一个|做一个)+/, '')
    .replace(/^(一个|一只|一条|一辆|一朵|一棵|一座|张|只|个|条|辆|朵|棵|座)+/, '')
    .replace(/[，。,.、\s]/g, '')
    .slice(0, 24);
  if (textName) return textName;

  const names = recipe.map((item) => item.name).filter((name): name is string => Boolean(name));
  const prefix = commonPrefix(names).slice(0, 12);
  return prefix.length >= 1 ? prefix : undefined;
};

const commonPrefix = (items: string[]) => {
  if (items.length === 0) return '';
  let prefix = items[0];
  for (const item of items.slice(1)) {
    while (prefix && !item.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
};

const hasEditableTarget = (scene: SceneState, selector: DrawingIntent['selector']) =>
  Boolean(findObject(scene.objects, selector ?? { mode: 'selected' }, scene.selectedId, scene.selection));

const HELP_MESSAGE =
  '可以说：画一个红色圆形、画一个房子和太阳、选择太阳、把它改成黄色、把月亮改名为星星、复制星星、把所有图形成组、把所有图形左对齐、水平分布所有图形、把文字改成世界、向右移动一点、撤销、导出图片，或问我画布里有什么。';

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
  if (scene.selection?.scope === 'part' && selected.kind === 'svg_artwork') {
    return `当前选中：${selected.svgArtwork?.name ?? selected.name}里的${scene.selection.partName ?? '局部'}。这是一张安全 SVG 插画，支持整体移动和可定位局部编辑。`;
  }
  if (selected.groupId) {
    const groupObjects = scene.objects.filter((object) => object.groupId === selected.groupId);
    return `当前选中：${selected.groupName ?? selected.name}素材组，包含 ${groupObjects.length} 个部件。位置 ${Math.round(selected.x)}、${Math.round(selected.y)}。`;
  }
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

const noTarget = (message = '当前没有可编辑的图形，请先说“画一个圆形”之类的指令。') => ({
  commands: [],
  message,
  needsClarification: true
});

const inferGroupName = (rawText: string, targets: SceneObject[]) => {
  const customName = detectCustomName(rawText);
  if (customName) return customName;

  const names = targets.map((object) => object.groupName ?? object.name).filter(Boolean);
  const prefix = commonPrefix(names).slice(0, 8);
  return prefix.length >= 2 ? `${prefix}组` : '语音组合';
};

const compactStyleUpdate = (updates: { style: { fill?: string; stroke?: string; strokeWidth?: number } }) => ({
  style: Object.fromEntries(Object.entries(updates.style).filter(([, value]) => value !== undefined)) as {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }
});

const hasStyleUpdate = (updates: ReturnType<typeof compactStyleUpdate>) => Object.keys(updates.style).length > 0;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const createGroupId = () => `asset-${nextId++}`;
const createId = () => `shape-${nextId++}`;
const createPartId = () => `part-${nextId++}`;
const partIdForName = (partIdsByName: Map<string, string>, partName: string) => {
  const key = partName.trim().slice(0, 24);
  const existing = partIdsByName.get(key);
  if (existing) return existing;
  const next = createPartId();
  partIdsByName.set(key, next);
  return next;
};
const duplicateLabel = (value: string) => {
  const trimmed = value.trim().slice(0, 20) || '副本';
  if (/副本\d*$/.test(trimmed)) return `${trimmed}2`;
  return `${trimmed}副本`;
};
