import type { DrawingIntent, DrawingIntentType, DrawingRecipeItem, LayerDirection, ObjectSelector, SceneState, ShapeKind } from '../domain/types';

export interface AiIntentRequestPayload {
  transcript: string;
  scene: {
    objects: Array<{
      name: string;
      kind: ShapeKind;
      fill: string;
    }>;
    selectedName: string | null;
  };
  localReason?: string;
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

const INTENT_TYPES: DrawingIntentType[] = [
  'sequence',
  'create_shape',
  'create_complex_scene',
  'create_asset_recipe',
  'select_object',
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

export const toAiIntentRequestPayload = (transcript: string, scene: SceneState, localReason?: string): AiIntentRequestPayload => ({
  transcript,
  localReason,
  scene: {
    objects: scene.objects.map((object) => ({
      name: object.name,
      kind: object.kind,
      fill: object.style.fill
    })),
    selectedName: scene.selectedId ? scene.objects.find((object) => object.id === scene.selectedId)?.name ?? null : null
  }
});

export const buildDeepSeekMessages = (payload: AiIntentRequestPayload) => [
  {
    role: 'system',
    content:
      '你是 Speak2Draw 的中文语音绘图意图解析器。只输出 JSON，不要解释。' +
      `把用户语音转换成一个 DrawingIntent。允许的 type：${INTENT_TYPES.join(', ')}。` +
      'shape 只能是 circle, rectangle, ellipse, line, triangle, text。direction 只能是 left, right, up, down, center, top-left, top-right, bottom-left, bottom-right。' +
      '当用户要画猫、船、云、人物等内置图形没有的元素时，优先返回 create_asset_recipe，并用 recipe 数组拆成多个安全矢量对象。recipe 每项只允许 shape, name, color, strokeColor, strokeWidth, position, width, height, text。' +
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
  return normalizeAiIntentValue(value, rawText, 0);
};

const normalizeAiIntentValue = (value: unknown, rawText: string, depth: number): DrawingIntent | null => {
  if (!isRecord(value) || typeof value.type !== 'string' || !INTENT_TYPES.includes(value.type as DrawingIntentType)) return null;

  const type = value.type as DrawingIntentType;
  const intent: DrawingIntent = { type, rawText };

  if (type === 'sequence') {
    if (!Array.isArray(value.intents) || depth > 0) return null;
    const intents = value.intents.slice(0, 6).map((item) => normalizeAiIntentValue(item, rawText, depth + 1));
    if (intents.some((item) => !item)) return null;
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
  if (typeof value.shape === 'string' && SHAPES.includes(value.shape as ShapeKind)) intent.shape = value.shape as ShapeKind;
  if (typeof value.width === 'number') intent.width = clampNumber(value.width, 20, 420);
  if (typeof value.height === 'number') intent.height = clampNumber(value.height, 20, 320);
  if (typeof value.direction === 'string' && DIRECTIONS.includes(value.direction as NonNullable<DrawingIntent['direction']>)) {
    intent.direction = value.direction as DrawingIntent['direction'];
  }
  if (typeof value.layer === 'string' && LAYERS.includes(value.layer as LayerDirection)) intent.layer = value.layer as LayerDirection;

  const selector = normalizeSelector(value.selector);
  if (selector) intent.selector = selector;

  if (isRecord(value.position) && typeof value.position.x === 'number' && typeof value.position.y === 'number') {
    intent.position = {
      x: clampNumber(value.position.x, 0, 960),
      y: clampNumber(value.position.y, 0, 600)
    };
  }

  const recipe = normalizeRecipe(value.recipe);
  if (recipe.length > 0) intent.recipe = recipe;

  return intent;
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
  if (selector.mode === 'last' || selector.mode === 'selected') return { mode: selector.mode };
  if (selector.mode === 'by_name' && typeof selector.name === 'string') {
    const name = selector.name.trim().slice(0, 24);
    return name ? { mode: 'by_name', name } : undefined;
  }
  if (selector.mode === 'by_shape_color') {
    const next: ObjectSelector = { mode: 'by_shape_color' };
    if (typeof selector.shape === 'string' && SHAPES.includes(selector.shape as ShapeKind)) next.shape = selector.shape as ShapeKind;
    if (typeof selector.color === 'string' && isHexColor(selector.color)) next.color = selector.color;
    return next.shape || next.color ? next : undefined;
  }
  return undefined;
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
