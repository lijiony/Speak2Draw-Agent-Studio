import type {
  AlignmentMode,
  DistributionAxis,
  DrawingIntent,
  DrawingIntentType,
  DrawingRecipeItem,
  LayerDirection,
  ObjectSelector,
  SceneState,
  ShapeKind
} from '../domain/types';

export interface AiIntentRequestPayload {
  transcript: string;
  scene: {
    revision: number;
    objects: Array<{
      id: string;
      name: string;
      groupId?: string;
      groupName?: string;
      partId?: string;
      partName?: string;
      kind: ShapeKind;
      fill: string;
      stroke: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    assets: Array<{
      groupId: string;
      groupName: string;
      bounds: Bounds;
      parts: Array<{
        objectId: string;
        name: string;
        partId?: string;
        partName?: string;
        kind: ShapeKind;
        fill: string;
        bounds: Bounds;
      }>;
    }>;
    selectedName: string | null;
    selection: {
      scope: 'group' | 'part';
      id: string;
      name: string;
      groupId?: string;
      groupName?: string;
      partName?: string;
    } | null;
  };
  localReason?: string;
  clarificationContext?: AiClarificationContext;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiClarificationContext {
  originalTranscript: string;
  question: string;
  reason?: string;
}

export interface AiIntentEnvelope {
  schemaVersion: typeof AI_INTENT_SCHEMA_VERSION;
  intent: DrawingIntent;
}

export interface AiIntentSuccessPayload {
  ok: true;
  provider: 'deepseek';
  model: string;
  intent: DrawingIntent;
}

export interface AiIntentFailurePayload {
  ok: false;
  provider: 'deepseek' | 'local';
  reason: string;
}

export type AiIntentResponsePayload = AiIntentSuccessPayload | AiIntentFailurePayload;

export const AI_INTENT_SCHEMA_VERSION = '1.0';

const INTENT_TYPES: DrawingIntentType[] = [
  'sequence',
  'create_shape',
  'create_complex_scene',
  'create_asset_recipe',
  'revise_asset_part',
  'select_object',
  'rename_object',
  'duplicate_object',
  'update_text',
  'group_objects',
  'ungroup_objects',
  'align_objects',
  'distribute_objects',
  'update_style',
  'move_object',
  'resize_object',
  'reorder_object',
  'delete_object',
  'clear_canvas',
  'export_canvas',
  'undo',
  'redo',
  'help',
  'describe_scene',
  'describe_selection',
  'clarify',
  'unknown'
];

const SHAPES: ShapeKind[] = ['circle', 'rectangle', 'ellipse', 'line', 'triangle', 'text'];
const DIRECTIONS: Array<NonNullable<DrawingIntent['direction']>> = ['left', 'right', 'up', 'down', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const LAYERS: LayerDirection[] = ['front', 'back', 'forward', 'backward'];
const ALIGNMENTS: AlignmentMode[] = ['left', 'center-x', 'right', 'top', 'center-y', 'bottom'];
const AXES: DistributionAxis[] = ['horizontal', 'vertical'];

export const AI_INTENT_JSON_SCHEMA = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  responseShape: {
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    intent: {
      type: INTENT_TYPES,
      shape: SHAPES,
      direction: DIRECTIONS,
      layer: LAYERS,
      alignment: ALIGNMENTS,
      axis: AXES,
      name: 'string for object or asset group name',
      color: '#RRGGBB',
      selector: {
        mode: ['selected', 'last', 'all', 'by_name', 'by_names', 'by_shape_color', 'by_id', 'by_group_id', 'by_part_name'],
        scope: ['group', 'part'],
        objectId: 'stable object id from scene objects',
        groupId: 'stable group id from scene assets',
        name: 'string',
        withinGroupName: 'string',
        names: ['string'],
        shape: SHAPES,
        color: '#RRGGBB'
      },
      attachTo: {
        mode: ['by_group_id', 'by_name'],
        groupId: 'stable group id',
        name: 'asset group name',
        scope: ['group']
      },
      operation: ['delete', 'replace'],
      recipe: [
        {
          shape: SHAPES,
          name: 'string',
          partName: 'string for local editable part, such as 帽子 or 窗户',
          color: '#RRGGBB',
          strokeColor: '#RRGGBB',
          strokeWidth: '1..16',
          position: { x: '0..940', y: '0..580' },
          width: '20..420',
          height: '20..320',
          text: 'string'
        }
      ],
      intents: ['DrawingIntent[] for sequence only'],
      reason: 'string for clarify or unknown'
    }
  },
  intentRequirements: {
    create_shape: ['shape'],
    create_asset_recipe: ['name is recommended', 'recipe with at least one safe item'],
    revise_asset_part: ['operation delete or replace', 'selector with part scope', 'recipe required when operation is replace'],
    rename_object: ['name'],
    duplicate_object: ['selector recommended'],
    update_text: ['text'],
    group_objects: ['selector recommended, use all or by_names for multiple targets'],
    ungroup_objects: ['selector recommended'],
    align_objects: ['alignment'],
    distribute_objects: ['axis'],
    update_style: ['color or strokeColor or strokeWidth'],
    move_object: ['direction'],
    resize_object: ['scale'],
    reorder_object: ['layer'],
    sequence: ['1..6 non-sequence child intents']
  }
} as const;

export const toAiIntentRequestPayload = (
  transcript: string,
  scene: SceneState,
  localReason?: string,
  clarificationContext?: AiClarificationContext
): AiIntentRequestPayload => ({
  transcript,
  localReason,
  clarificationContext: clarificationContext
    ? {
        originalTranscript: clarificationContext.originalTranscript,
        question: clarificationContext.question,
        ...(clarificationContext.reason ? { reason: clarificationContext.reason } : {})
      }
    : undefined,
  scene: {
    revision: scene.revision,
    objects: scene.objects.map((object) => ({
      id: object.id,
      name: object.name,
      ...(object.groupId ? { groupId: object.groupId } : {}),
      ...(object.groupName ? { groupName: object.groupName } : {}),
      ...(object.partId ? { partId: object.partId } : {}),
      ...(object.partName ? { partName: object.partName } : {}),
      kind: object.kind,
      fill: object.style.fill,
      stroke: object.style.stroke,
      x: Math.round(object.x),
      y: Math.round(object.y),
      width: Math.round(object.width),
      height: Math.round(object.height)
    })),
    assets: buildAssetTree(scene),
    selectedName: scene.selectedId ? scene.objects.find((object) => object.id === scene.selectedId)?.name ?? null : null,
    selection: buildSelectionSummary(scene)
  }
});

export const buildDeepSeekMessages = (payload: AiIntentRequestPayload) => [
  {
    role: 'system',
    content:
      '你是 Speak2Draw 的中文语音绘图意图解析器。只输出符合 schema 的 JSON，不要解释。' +
      `固定输出格式：{"schemaVersion":"${AI_INTENT_SCHEMA_VERSION}","intent":{...}}。` +
      `JSON schema 摘要：${JSON.stringify(AI_INTENT_JSON_SCHEMA)}。` +
      `把用户语音转换成一个 DrawingIntent。允许的 type：${INTENT_TYPES.join(', ')}。` +
      '如果请求包含 clarificationContext，说明上一轮语音没有执行成功；请把 originalTranscript、question 和本轮 transcript 合并理解，优先输出可执行意图。' +
      'shape 只能是 circle, rectangle, ellipse, line, triangle, text。direction 只能是 left, right, up, down, center, top-left, top-right, bottom-left, bottom-right。' +
      '如果用户要给已有图形改名、复制它、或者修改文字内容，请分别返回 rename_object、duplicate_object、update_text。' +
      '如果用户要成组、取消分组、对齐或均匀分布图形，请分别返回 group_objects、ungroup_objects、align_objects、distribute_objects。alignment 只能是 left, center-x, right, top, center-y, bottom；axis 只能是 horizontal 或 vertical。' +
      'scene.assets 是当前画布的素材组和部件树。用户说“选择房子的窗户”“删除帽子”“把猫的帽子换掉”时必须使用局部 selector，例如 by_id 或 by_part_name，并设置 scope:"part"，不要误删整组。用户说“整个房子”“整只猫”“选择房子”时才使用 scope:"group"。' +
      '当用户要画猫、船、云、人物等内置图形没有的元素时，优先返回 create_asset_recipe，并在 intent.name 写入整个素材名称，例如“猫”或“戴帽子的猫”，再用 recipe 数组拆成多个安全矢量对象。recipe 每项只允许 shape, name, partName, color, strokeColor, strokeWidth, position, width, height, text。系统会把这些部件按 intent.name 成组。' +
      '当用户要求删除或替换已有素材的一部分，例如“把帽子删去”“帽子不好看换一个”，优先返回 revise_asset_part。删除用 operation:"delete"；替换用 operation:"replace" 并提供 recipe，attachTo 指向原素材组。' +
      '颜色使用十六进制，例如红色 #ef4444、蓝色 #2563eb、绿色 #16a34a、黄色 #facc15、黑色 #111827、紫色 #7c3aed、粉色 #ec4899。' +
      '如果用户提到已有对象名称，使用 selector: { "mode": "by_name", "name": "对象名" }。如果包含多个动作，可以返回 {"type":"sequence","intents":[...]}。如果无法安全执行，返回 {"type":"unknown","reason":"..."}。'
  },
  {
    role: 'user',
    content: JSON.stringify(payload)
  }
] as const;

export const parseDeepSeekIntentContent = (content: string, rawText: string): DrawingIntent | null => {
  const parsed = parseJsonObject(content);
  return normalizeAiIntent(parsed, rawText);
};

export const normalizeAiIntent = (value: unknown, rawText: string): DrawingIntent | null => {
  return normalizeAiIntentValue(unwrapAiIntentValue(value), rawText, 0);
};

const normalizeAiIntentValue = (value: unknown, rawText: string, depth: number): DrawingIntent | null => {
  if (!isRecord(value) || typeof value.type !== 'string' || !INTENT_TYPES.includes(value.type as DrawingIntentType)) return null;

  const type = value.type as DrawingIntentType;
  const intent: DrawingIntent = { type, rawText };

  if (type === 'sequence') {
    if (!Array.isArray(value.intents) || depth > 0) return null;
    const intents = value.intents.slice(0, 6).map((item) => normalizeAiIntentValue(item, rawText, depth + 1));
    if (intents.length === 0 || intents.some((item) => !item || item.type === 'sequence' || item.type === 'unknown' || item.type === 'clarify')) return null;
    intent.intents = intents as DrawingIntent[];
    return intent;
  }

  if (typeof value.reason === 'string') intent.reason = value.reason.slice(0, 120);
  if (typeof value.name === 'string') intent.name = value.name.trim().slice(0, 24);
  if (typeof value.color === 'string' && isHexColor(value.color)) intent.color = value.color;
  if (typeof value.strokeColor === 'string' && isHexColor(value.strokeColor)) intent.strokeColor = value.strokeColor;
  if (typeof value.strokeWidth === 'number') intent.strokeWidth = clampNumber(value.strokeWidth, 1, 16);
  if (typeof value.scale === 'number') intent.scale = clampNumber(value.scale, 0.2, 4);
  if (typeof value.text === 'string') intent.text = value.text.slice(0, 80);
  if (value.operation === 'delete' || value.operation === 'replace') intent.operation = value.operation;
  if (typeof value.shape === 'string' && SHAPES.includes(value.shape as ShapeKind)) intent.shape = value.shape as ShapeKind;
  if (typeof value.width === 'number') intent.width = clampNumber(value.width, 20, 420);
  if (typeof value.height === 'number') intent.height = clampNumber(value.height, 20, 320);
  if (typeof value.direction === 'string' && DIRECTIONS.includes(value.direction as NonNullable<DrawingIntent['direction']>)) {
    intent.direction = value.direction as DrawingIntent['direction'];
  }
  if (typeof value.layer === 'string' && LAYERS.includes(value.layer as LayerDirection)) intent.layer = value.layer as LayerDirection;
  if (typeof value.alignment === 'string' && ALIGNMENTS.includes(value.alignment as AlignmentMode)) intent.alignment = value.alignment as AlignmentMode;
  if (typeof value.axis === 'string' && AXES.includes(value.axis as DistributionAxis)) intent.axis = value.axis as DistributionAxis;

  const selector = normalizeSelector(value.selector);
  if (selector) intent.selector = selector;
  const attachTo = normalizeSelector(value.attachTo);
  if (attachTo) intent.attachTo = attachTo;

  if (isRecord(value.position) && typeof value.position.x === 'number' && typeof value.position.y === 'number') {
    intent.position = {
      x: clampNumber(value.position.x, 0, 960),
      y: clampNumber(value.position.y, 0, 600)
    };
  }

  const recipe = normalizeRecipe(value.recipe);
  if (recipe.length > 0) intent.recipe = recipe;

  return isIntentStructurallyExecutable(intent) ? intent : null;
};

const unwrapAiIntentValue = (value: unknown) => {
  if (!isRecord(value)) return value;
  if (value.schemaVersion === AI_INTENT_SCHEMA_VERSION && isRecord(value.intent)) return value.intent;
  return value;
};

const isIntentStructurallyExecutable = (intent: DrawingIntent) => {
  switch (intent.type) {
    case 'create_shape':
      return Boolean(intent.shape);
    case 'create_asset_recipe':
      return Boolean(intent.recipe?.length);
    case 'revise_asset_part':
      return Boolean(intent.selector && (intent.operation === 'delete' || (intent.operation === 'replace' && intent.recipe?.length)));
    case 'rename_object':
      return Boolean(intent.name);
    case 'update_text':
      return Boolean(intent.text);
    case 'update_style':
      return Boolean(intent.color || intent.strokeColor || intent.strokeWidth);
    case 'move_object':
      return Boolean(intent.direction);
    case 'resize_object':
      return typeof intent.scale === 'number';
    case 'reorder_object':
      return Boolean(intent.layer);
    case 'align_objects':
      return Boolean(intent.alignment);
    case 'distribute_objects':
      return Boolean(intent.axis);
    case 'clarify':
    case 'unknown':
      return Boolean(intent.reason);
    default:
      return true;
  }
};

const normalizeRecipe = (recipe: unknown): DrawingRecipeItem[] => {
  if (!Array.isArray(recipe)) return [];

  return recipe
    .slice(0, 16)
    .map((item) => {
      if (!isRecord(item) || typeof item.shape !== 'string' || !SHAPES.includes(item.shape as ShapeKind)) return null;
      const normalized: DrawingRecipeItem = {
        shape: item.shape as ShapeKind
      };
      if (typeof item.name === 'string') normalized.name = item.name.trim().slice(0, 24);
      if (typeof item.partName === 'string') normalized.partName = item.partName.trim().slice(0, 24);
      if (typeof item.color === 'string' && isHexColor(item.color)) normalized.color = item.color;
      if (typeof item.strokeColor === 'string' && isHexColor(item.strokeColor)) normalized.strokeColor = item.strokeColor;
      if (typeof item.strokeWidth === 'number') normalized.strokeWidth = clampNumber(item.strokeWidth, 1, 16);
      if (typeof item.width === 'number') normalized.width = clampNumber(item.width, 20, 420);
      if (typeof item.height === 'number') normalized.height = clampNumber(item.height, 20, 320);
      if (typeof item.text === 'string') normalized.text = item.text.slice(0, 80);
      if (isRecord(item.position) && typeof item.position.x === 'number' && typeof item.position.y === 'number') {
        normalized.position = {
          x: clampNumber(item.position.x, 0, 940),
          y: clampNumber(item.position.y, 0, 580)
        };
      }
      return normalized;
    })
    .filter((item): item is DrawingRecipeItem => Boolean(item));
};

const normalizeSelector = (selector: unknown): ObjectSelector | undefined => {
  if (!isRecord(selector) || typeof selector.mode !== 'string') return undefined;
  const scope = selector.scope === 'group' || selector.scope === 'part' ? selector.scope : undefined;
  if (selector.mode === 'last' || selector.mode === 'selected') return { mode: selector.mode, ...(scope ? { scope } : {}) };
  if (selector.mode === 'all') return { mode: 'all', ...(scope ? { scope } : {}) };
  if (selector.mode === 'by_id' && typeof selector.objectId === 'string') {
    const objectId = selector.objectId.trim().slice(0, 40);
    return objectId ? { mode: 'by_id', objectId, scope: scope ?? 'part' } : undefined;
  }
  if (selector.mode === 'by_group_id' && typeof selector.groupId === 'string') {
    const groupId = selector.groupId.trim().slice(0, 40);
    return groupId ? { mode: 'by_group_id', groupId, scope: 'group' } : undefined;
  }
  if (selector.mode === 'by_part_name' && typeof selector.name === 'string') {
    const name = selector.name.trim().slice(0, 24);
    const withinGroupName = typeof selector.withinGroupName === 'string' ? selector.withinGroupName.trim().slice(0, 24) : undefined;
    return name ? { mode: 'by_part_name', name, ...(withinGroupName ? { withinGroupName } : {}), scope: 'part' } : undefined;
  }
  if (selector.mode === 'by_name' && typeof selector.name === 'string') {
    const name = selector.name.trim().slice(0, 24);
    return name ? { mode: 'by_name', name, ...(scope ? { scope } : {}) } : undefined;
  }
  if (selector.mode === 'by_names' && Array.isArray(selector.names)) {
    const names = selector.names
      .filter((name): name is string => typeof name === 'string')
      .map((name) => name.trim().slice(0, 24))
      .filter(Boolean)
      .slice(0, 8);
    return names.length > 0 ? { mode: 'by_names', names, ...(scope ? { scope } : {}) } : undefined;
  }
  if (selector.mode === 'by_shape_color') {
    const next: ObjectSelector = { mode: 'by_shape_color', ...(scope ? { scope } : {}) };
    if (typeof selector.shape === 'string' && SHAPES.includes(selector.shape as ShapeKind)) next.shape = selector.shape as ShapeKind;
    if (typeof selector.color === 'string' && isHexColor(selector.color)) next.color = selector.color;
    return next.shape || next.color ? next : undefined;
  }
  return undefined;
};

const buildAssetTree = (scene: SceneState): AiIntentRequestPayload['scene']['assets'] => {
  const groups = new Map<string, typeof scene.objects>();
  for (const object of scene.objects) {
    if (!object.groupId) continue;
    groups.set(object.groupId, [...(groups.get(object.groupId) ?? []), object]);
  }

  return [...groups.entries()].map(([groupId, objects]) => ({
    groupId,
    groupName: objects[0]?.groupName ?? '素材组',
    bounds: boundsForObjects(objects),
    parts: objects.map((object) => ({
      objectId: object.id,
      name: object.name,
      ...(object.partId ? { partId: object.partId } : {}),
      ...(object.partName ? { partName: object.partName } : {}),
      kind: object.kind,
      fill: object.style.fill,
      bounds: boundsForObjects([object])
    }))
  }));
};

const buildSelectionSummary = (scene: SceneState): AiIntentRequestPayload['scene']['selection'] => {
  const selection = scene.selection;
  if (!selection) return null;
  if (selection.scope === 'group') {
    const groupObjects = scene.objects.filter((object) => object.groupId === selection.groupId);
    const anchor = groupObjects.find((object) => object.id === selection.anchorObjectId) ?? groupObjects[0];
    return anchor
      ? {
          scope: 'group',
          id: selection.groupId,
          name: anchor.groupName ?? anchor.name,
          groupId: selection.groupId,
          groupName: anchor.groupName
        }
      : null;
  }

  const selected = scene.objects.find((object) => object.id === selection.objectId);
  return selected
    ? {
        scope: 'part',
        id: selected.id,
        name: selected.partName ?? selected.name,
        ...(selected.groupId ? { groupId: selected.groupId } : {}),
        ...(selected.groupName ? { groupName: selected.groupName } : {}),
        ...(selected.partName ? { partName: selected.partName } : {})
      }
    : null;
};

const boundsForObjects = (objects: SceneState['objects']): Bounds => {
  const minX = Math.min(...objects.map((object) => object.x));
  const minY = Math.min(...objects.map((object) => object.y));
  const maxX = Math.max(...objects.map((object) => object.x + object.width));
  const maxY = Math.max(...objects.map((object) => object.y + object.height));
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY)
  };
};

const parseJsonObject = (content: string) => {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
