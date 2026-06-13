import { CANVAS_HEIGHT, CANVAS_WIDTH } from './sceneModel';
import type {
  DrawingRecipeItem,
  LayoutDiagnostics,
  LayoutPartDiagnostics,
  RecipeSize,
  RecipeSlot,
  SceneObject,
  SceneState,
  ShapeKind
} from './types';

type Bounds = LayoutDiagnostics['bounds'];

export interface LaidOutRecipeItem {
  item: DrawingRecipeItem;
  name: string;
  slot: RecipeSlot;
  size: RecipeSize;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssetRecipeLayoutOptions {
  recipe: DrawingRecipeItem[];
  scene: SceneState;
  groupName?: string;
  groupId?: string;
  placementTarget?: SceneObject;
  schemaVersion?: string;
  rawSummary?: string;
  transcript?: string;
}

export interface AssetRecipeLayoutResult {
  items: LaidOutRecipeItem[];
  diagnostics: LayoutDiagnostics;
}

const DEFAULT_SLOT_ORDER: RecipeSlot[] = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right', 'top', 'bottom'];
const SLOTS: Record<RecipeSlot, { x: number; y: number }> = {
  center: { x: 0.5, y: 0.5 },
  top: { x: 0.5, y: 0.18 },
  bottom: { x: 0.5, y: 0.82 },
  left: { x: 0.22, y: 0.5 },
  right: { x: 0.78, y: 0.5 },
  'top-left': { x: 0.24, y: 0.24 },
  'top-right': { x: 0.76, y: 0.24 },
  'bottom-left': { x: 0.24, y: 0.76 },
  'bottom-right': { x: 0.76, y: 0.76 }
};

const SIZE_PRESETS: Record<ShapeKind, Record<RecipeSize, { width: number; height: number }>> = {
  circle: {
    tiny: { width: 24, height: 24 },
    small: { width: 48, height: 48 },
    medium: { width: 92, height: 92 },
    large: { width: 150, height: 150 }
  },
  rectangle: {
    tiny: { width: 34, height: 22 },
    small: { width: 70, height: 42 },
    medium: { width: 116, height: 76 },
    large: { width: 190, height: 126 }
  },
  ellipse: {
    tiny: { width: 34, height: 20 },
    small: { width: 70, height: 42 },
    medium: { width: 122, height: 76 },
    large: { width: 190, height: 116 }
  },
  line: {
    tiny: { width: 36, height: 6 },
    small: { width: 74, height: 7 },
    medium: { width: 130, height: 8 },
    large: { width: 190, height: 10 }
  },
  triangle: {
    tiny: { width: 32, height: 28 },
    small: { width: 64, height: 56 },
    medium: { width: 104, height: 86 },
    large: { width: 164, height: 128 }
  },
  text: {
    tiny: { width: 68, height: 30 },
    small: { width: 104, height: 40 },
    medium: { width: 156, height: 54 },
    large: { width: 230, height: 72 }
  }
};

export const layoutAssetRecipe = ({
  recipe,
  scene,
  groupName,
  groupId,
  placementTarget,
  schemaVersion,
  rawSummary,
  transcript
}: AssetRecipeLayoutOptions): AssetRecipeLayoutResult => {
  const warnings: string[] = [];
  const safeRecipe = recipe.slice(0, 16);
  const anchorObjects = groupId ? scene.objects.filter((object) => object.groupId === groupId) : [];
  const layoutArea = createLayoutArea(safeRecipe, anchorObjects, placementTarget);
  const positionBounds = recipePositionBounds(safeRecipe);
  const useRecipePositions = Boolean(positionBounds && positionBounds.width >= 24 && positionBounds.height >= 24);
  const anchors = buildAnchorMap(anchorObjects);
  const placed: LaidOutRecipeItem[] = [];
  const diagnosticsParts: LayoutPartDiagnostics[] = [];
  const repeatedCenters = new Map<string, number>();

  safeRecipe.forEach((item, index) => {
    const size = item.size ?? inferRecipeSize(item, safeRecipe.length);
    const dimensions = dimensionsForItem(item, size);
    const slot = item.slot ?? (item.relativeTo ? 'center' : slotFromPosition(item, positionBounds) ?? DEFAULT_SLOT_ORDER[index % DEFAULT_SLOT_ORDER.length]);
    const relativeKey = item.relativeTo ? normalizeAnchorKey(item.relativeTo) : undefined;
    const anchor = relativeKey ? anchors.get(relativeKey) : undefined;
    const partWarnings: string[] = [];
    let point = anchor ? pointRelativeToAnchor(item, anchor, slot, dimensions) : pointInArea(layoutArea, slot, dimensions);

    if (!anchor && useRecipePositions && item.position && !item.slot) {
      point = pointFromPositionSuggestion(item, dimensions, layoutArea, positionBounds);
    }

    if (item.relativeTo && !anchor) {
      partWarnings.push(`未找到 relativeTo: ${item.relativeTo}`);
      warnings.push(`${item.name ?? item.partName ?? `部件${index + 1}`} 未找到参照部件 ${item.relativeTo}，已按 ${slot} 排布。`);
    }

    point = applyOffset(point, item, layoutArea);
    point = spreadExactDuplicate(point, dimensions, repeatedCenters, item);
    point = clampPoint(point, dimensions);

    const name = item.name ?? item.partName ?? `${groupName ?? '素材'}部件${index + 1}`;
    const laidOut: LaidOutRecipeItem = {
      item,
      name,
      slot,
      size,
      x: Math.round(point.x),
      y: Math.round(point.y),
      width: Math.round(dimensions.width),
      height: Math.round(dimensions.height)
    };
    placed.push(laidOut);
    addAnchor(anchors, laidOut);
    diagnosticsParts.push({
      index,
      name,
      ...(item.partName ? { partName: item.partName } : {}),
      shape: item.shape,
      slot,
      ...(item.relativeTo ? { relativeTo: item.relativeTo } : {}),
      size,
      x: laidOut.x,
      y: laidOut.y,
      width: laidOut.width,
      height: laidOut.height,
      ...(partWarnings.length ? { warnings: partWarnings } : {})
    });
  });

  const fitted = fitItemsIntoCanvas(placed, warnings);
  fitted.forEach((item, index) => {
    diagnosticsParts[index] = {
      ...diagnosticsParts[index],
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height
    };
  });

  return {
    items: fitted,
    diagnostics: {
      schemaVersion,
      rawSummary,
      transcript,
      groupName,
      groupId,
      inputCount: recipe.length,
      acceptedCount: fitted.length,
      droppedCount: Math.max(0, recipe.length - fitted.length),
      commandCount: fitted.length,
      warnings,
      bounds: boundsForLayoutItems(fitted),
      parts: diagnosticsParts
    }
  };
};

export const boundsForObjects = (objects: SceneObject[]): Bounds => {
  if (!objects.length) return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, width: 0, height: 0 };
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

const createLayoutArea = (recipe: DrawingRecipeItem[], anchorObjects: SceneObject[], placementTarget?: SceneObject): Bounds => {
  if (placementTarget) return expandBounds(boundsForObjects([placementTarget]), 2.4, 2);
  if (anchorObjects.length) return expandBounds(boundsForObjects(anchorObjects), 1.35, 1.2);

  const density = Math.min(recipe.length, 12);
  const width = clamp(280 + density * 22, 300, 520);
  const height = clamp(220 + density * 18, 230, 410);
  return {
    x: Math.round((CANVAS_WIDTH - width) / 2),
    y: Math.round((CANVAS_HEIGHT - height) / 2),
    width,
    height
  };
};

const expandBounds = (bounds: Bounds, widthScale: number, heightScale: number): Bounds => {
  const width = clamp(Math.max(140, bounds.width * widthScale), 160, CANVAS_WIDTH - 96);
  const height = clamp(Math.max(120, bounds.height * heightScale), 120, CANVAS_HEIGHT - 96);
  return {
    x: clamp(Math.round(bounds.x + bounds.width / 2 - width / 2), 48, CANVAS_WIDTH - width - 48),
    y: clamp(Math.round(bounds.y + bounds.height / 2 - height / 2), 48, CANVAS_HEIGHT - height - 48),
    width: Math.round(width),
    height: Math.round(height)
  };
};

const inferRecipeSize = (item: DrawingRecipeItem, count: number): RecipeSize => {
  const label = `${item.name ?? ''}${item.partName ?? ''}`;
  if (/(眼|鼻|嘴|瞳|纽扣|星点|斑点|花蕊|把手|烟囱)/.test(label)) return 'tiny';
  if (/(耳|帽檐|窗|门|帆|叶|花瓣|轮|尾巴|胡须)/.test(label)) return 'small';
  if (count <= 2) return 'large';
  if (/(脸|身体|船身|墙体|花瓶|云朵|树冠|主体)/.test(label)) return 'large';
  return 'medium';
};

const dimensionsForItem = (item: DrawingRecipeItem, size: RecipeSize) => {
  const preset = SIZE_PRESETS[item.shape][size];
  return {
    width: clamp(item.width ?? preset.width, 16, 420),
    height: clamp(item.height ?? preset.height, item.shape === 'line' ? 4 : 16, 320)
  };
};

const pointInArea = (area: Bounds, slot: RecipeSlot, dimensions: { width: number; height: number }) => {
  const ratio = SLOTS[slot];
  return {
    x: area.x + area.width * ratio.x - dimensions.width / 2,
    y: area.y + area.height * ratio.y - dimensions.height / 2
  };
};

const pointRelativeToAnchor = (
  item: DrawingRecipeItem,
  anchor: Bounds,
  slot: RecipeSlot,
  dimensions: { width: number; height: number }
) => {
  if (isInternalPart(item)) {
    const inside = SLOTS[slot];
    return {
      x: anchor.x + anchor.width * inside.x - dimensions.width / 2,
      y: anchor.y + anchor.height * inside.y - dimensions.height / 2
    };
  }

  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  const horizontal = slot.includes('left') ? -1 : slot.includes('right') ? 1 : 0;
  const vertical = slot.includes('top') ? -1 : slot.includes('bottom') ? 1 : 0;
  const x = horizontal === 0 ? centerX - dimensions.width / 2 : centerX + horizontal * (anchor.width * 0.42 + dimensions.width * 0.18) - dimensions.width / 2;
  const y = vertical === 0 ? centerY - dimensions.height / 2 : centerY + vertical * (anchor.height * 0.44 + dimensions.height * 0.18) - dimensions.height / 2;
  return { x, y };
};

const isInternalPart = (item: DrawingRecipeItem) => {
  const label = `${item.name ?? ''}${item.partName ?? ''}`;
  return /(眼|鼻|嘴|瞳|脸颊|窗|门|按钮|纹|花纹|图案|文字|花蕊|把手)/.test(label);
};

const applyOffset = (point: { x: number; y: number }, item: DrawingRecipeItem, area: Bounds) => {
  if (!item.offset) return point;
  return {
    x: point.x + clamp(item.offset.x, -1, 1) * Math.min(80, area.width * 0.18),
    y: point.y + clamp(item.offset.y, -1, 1) * Math.min(70, area.height * 0.18)
  };
};

const spreadExactDuplicate = (
  point: { x: number; y: number },
  dimensions: { width: number; height: number },
  repeatedCenters: Map<string, number>,
  item: DrawingRecipeItem
) => {
  if (item.relativeTo || isInternalPart(item)) return point;
  const key = `${Math.round((point.x + dimensions.width / 2) / 8)}:${Math.round((point.y + dimensions.height / 2) / 8)}`;
  const count = repeatedCenters.get(key) ?? 0;
  repeatedCenters.set(key, count + 1);
  if (!count) return point;
  const angle = (Math.PI * 2 * count) / 6;
  const radius = 42 + count * 10;
  return {
    x: point.x + Math.cos(angle) * radius,
    y: point.y + Math.sin(angle) * radius
  };
};

const clampPoint = (point: { x: number; y: number }, dimensions: { width: number; height: number }) => ({
  x: clamp(point.x, 16, CANVAS_WIDTH - dimensions.width - 16),
  y: clamp(point.y, 16, CANVAS_HEIGHT - dimensions.height - 16)
});

const fitItemsIntoCanvas = (items: LaidOutRecipeItem[], warnings: string[]): LaidOutRecipeItem[] => {
  if (!items.length) return items;
  const bounds = boundsForLayoutItems(items);
  const maxWidth = CANVAS_WIDTH - 64;
  const maxHeight = CANVAS_HEIGHT - 64;
  const scale = Math.min(1, maxWidth / bounds.width, maxHeight / bounds.height);
  let next = items;

  if (scale < 1) {
    warnings.push(`布局超出画布，已按 ${Math.round(scale * 100)}% 自动缩放。`);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    next = items.map((item) => ({
      ...item,
      x: Math.round(centerX + (item.x - centerX) * scale),
      y: Math.round(centerY + (item.y - centerY) * scale),
      width: Math.round(item.width * scale),
      height: Math.round(item.height * scale)
    }));
  }

  const fittedBounds = boundsForLayoutItems(next);
  const dx = fittedBounds.x < 32 ? 32 - fittedBounds.x : fittedBounds.x + fittedBounds.width > CANVAS_WIDTH - 32 ? CANVAS_WIDTH - 32 - (fittedBounds.x + fittedBounds.width) : 0;
  const dy = fittedBounds.y < 32 ? 32 - fittedBounds.y : fittedBounds.y + fittedBounds.height > CANVAS_HEIGHT - 32 ? CANVAS_HEIGHT - 32 - (fittedBounds.y + fittedBounds.height) : 0;
  if (dx || dy) warnings.push('布局贴近画布边界，已整体平移到安全区域。');
  return next.map((item) => ({ ...item, x: Math.round(item.x + dx), y: Math.round(item.y + dy) }));
};

const recipePositionBounds = (recipe: DrawingRecipeItem[]): Bounds | null => {
  const points = recipe.filter((item) => item.position);
  if (points.length < 2) return null;
  const minX = Math.min(...points.map((item) => item.position?.x ?? 0));
  const minY = Math.min(...points.map((item) => item.position?.y ?? 0));
  const maxX = Math.max(...points.map((item) => (item.position?.x ?? 0) + (item.width ?? dimensionsForItem(item, item.size ?? 'medium').width)));
  const maxY = Math.max(...points.map((item) => (item.position?.y ?? 0) + (item.height ?? dimensionsForItem(item, item.size ?? 'medium').height)));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
};

const slotFromPosition = (item: DrawingRecipeItem, bounds: Bounds | null): RecipeSlot | null => {
  if (!item.position || !bounds || bounds.width < 24 || bounds.height < 24) return null;
  const ratioX = clamp((item.position.x - bounds.x) / bounds.width, 0, 1);
  const ratioY = clamp((item.position.y - bounds.y) / bounds.height, 0, 1);
  const horizontal = ratioX < 0.35 ? 'left' : ratioX > 0.65 ? 'right' : 'center';
  const vertical = ratioY < 0.35 ? 'top' : ratioY > 0.65 ? 'bottom' : 'center';
  if (horizontal === 'center' && vertical === 'center') return 'center';
  if (horizontal === 'center') return vertical as RecipeSlot;
  if (vertical === 'center') return horizontal as RecipeSlot;
  return `${vertical}-${horizontal}` as RecipeSlot;
};

const pointFromPositionSuggestion = (
  item: DrawingRecipeItem,
  dimensions: { width: number; height: number },
  area: Bounds,
  bounds: Bounds | null
) => {
  if (!item.position || !bounds) return pointInArea(area, 'center', dimensions);
  const sourceDimensions = {
    width: item.width ?? dimensions.width,
    height: item.height ?? dimensions.height
  };
  const centerRatioX = clamp((item.position.x + sourceDimensions.width / 2 - bounds.x) / bounds.width, 0, 1);
  const centerRatioY = clamp((item.position.y + sourceDimensions.height / 2 - bounds.y) / bounds.height, 0, 1);
  return {
    x: area.x + area.width * centerRatioX - dimensions.width / 2,
    y: area.y + area.height * centerRatioY - dimensions.height / 2
  };
};

const buildAnchorMap = (objects: SceneObject[]) => {
  const anchors = new Map<string, Bounds>();
  for (const object of objects) {
    const bounds = boundsForObjects([object]);
    addAnchorKey(anchors, object.name, bounds);
    addAnchorKey(anchors, object.partName, bounds);
    addAnchorKey(anchors, object.groupName, boundsForObjects(objects.filter((candidate) => candidate.groupId === object.groupId)));
  }
  return anchors;
};

const addAnchor = (anchors: Map<string, Bounds>, item: LaidOutRecipeItem) => {
  const bounds = { x: item.x, y: item.y, width: item.width, height: item.height };
  addAnchorKey(anchors, item.name, bounds);
  addAnchorKey(anchors, item.item.partName, bounds);
};

const addAnchorKey = (anchors: Map<string, Bounds>, key: string | undefined, bounds: Bounds) => {
  const normalized = normalizeAnchorKey(key);
  if (normalized && !anchors.has(normalized)) anchors.set(normalized, bounds);
};

const normalizeAnchorKey = (key: string | undefined) => key?.trim().toLowerCase().replace(/\s+/g, '');

const boundsForLayoutItems = (items: LaidOutRecipeItem[]): Bounds => {
  if (!items.length) return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, width: 0, height: 0 };
  const minX = Math.min(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY)
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
