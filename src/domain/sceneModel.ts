import type { DrawingCommand, ObjectSelector, SceneObject, SceneSnapshot, SceneState, ShapeKind } from './types';

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 600;

export const createEmptyScene = (): SceneState => ({
  objects: [],
  selectedId: null,
  past: [],
  future: []
});

const snapshot = (scene: SceneState): SceneSnapshot => ({
  objects: scene.objects.map((object) => ({ ...object, style: { ...object.style } })),
  selectedId: scene.selectedId
});

const withHistory = (scene: SceneState, next: SceneSnapshot): SceneState => ({
  ...next,
  past: [...scene.past, snapshot(scene)],
  future: []
});

const withoutHistory = (scene: SceneState, next: SceneSnapshot): SceneState => ({
  ...next,
  past: scene.past,
  future: scene.future
});

const applySnapshot = (scene: SceneState, next: SceneSnapshot, recordHistory: boolean): SceneState =>
  recordHistory ? withHistory(scene, next) : withoutHistory(scene, next);

export const createSceneObject = (
  kind: ShapeKind,
  options: {
    id: string;
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    text?: string;
  }
): SceneObject => ({
  id: options.id,
  kind,
  name: options.name ?? shapeName(kind),
  x: options.x ?? CANVAS_WIDTH / 2 - 60,
  y: options.y ?? CANVAS_HEIGHT / 2 - 60,
  width: options.width ?? defaultSize(kind).width,
  height: options.height ?? defaultSize(kind).height,
  text: options.text,
  createdAt: Date.now(),
  style: {
    fill: options.fill ?? (kind === 'line' ? 'none' : '#f9fafb'),
    stroke: options.stroke ?? '#111827',
    strokeWidth: options.strokeWidth ?? 4
  }
});

export const applyCommand = (scene: SceneState, command: DrawingCommand): SceneState => applyCommandInternal(scene, command, true);

const applyCommandInternal = (scene: SceneState, command: DrawingCommand, recordHistory: boolean): SceneState => {
  switch (command.type) {
    case 'create_object': {
      if (!command.object) return scene;
      const nextObjects = [...scene.objects, command.object];
      return applySnapshot(scene, { objects: nextObjects, selectedId: command.object.id }, recordHistory);
    }
    case 'select_object': {
      const selected = findObject(scene.objects, command.selector);
      return { ...scene, selectedId: selected?.id ?? scene.selectedId };
    }
    case 'update_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target || !command.updates) return scene;
      const objects = scene.objects.map((object) =>
        object.id === target.id
          ? {
              ...object,
              ...command.updates,
              style: command.updates?.style ? { ...object.style, ...command.updates.style } : object.style
            }
          : object
      );
      return applySnapshot(scene, { objects, selectedId: target.id }, recordHistory);
    }
    case 'move_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target) return scene;
      const moved = moveObject(target, command.direction);
      const objects = scene.objects.map((object) => (object.id === target.id ? moved : object));
      return applySnapshot(scene, { objects, selectedId: target.id }, recordHistory);
    }
    case 'resize_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target) return scene;
      const scale = command.scale ?? 1;
      const resized = {
        ...target,
        width: clamp(target.width * scale, 20, CANVAS_WIDTH - target.x),
        height: clamp(target.height * scale, 20, CANVAS_HEIGHT - target.y)
      };
      const objects = scene.objects.map((object) => (object.id === target.id ? resized : object));
      return applySnapshot(scene, { objects, selectedId: target.id }, recordHistory);
    }
    case 'reorder_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target) return scene;
      const objects = reorderObject(scene.objects, target.id, command.layer ?? 'front');
      return objects === scene.objects ? scene : applySnapshot(scene, { objects, selectedId: target.id }, recordHistory);
    }
    case 'delete_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target) return scene;
      const objects = scene.objects.filter((object) => object.id !== target.id);
      return applySnapshot(scene, { objects, selectedId: null }, recordHistory);
    }
    case 'clear_canvas':
      return applySnapshot(scene, { objects: [], selectedId: null }, recordHistory);
    case 'undo':
      return undo(scene);
    case 'redo':
      return redo(scene);
    case 'export_canvas':
      return scene;
    default:
      return scene;
  }
};

export const applyCommands = (scene: SceneState, commands: DrawingCommand[]): SceneState =>
  commands.reduce((nextScene, command) => applyCommand(nextScene, command), scene);

export const applyCommandsAsTransaction = (scene: SceneState, commands: DrawingCommand[]): SceneState => {
  if (commands.length <= 1) return applyCommands(scene, commands);

  const nextScene = commands.reduce((nextScene, command) => applyCommandInternal(nextScene, command, false), scene);
  if (!sceneSnapshotChanged(scene, nextScene)) return nextScene;

  return {
    ...snapshot(nextScene),
    past: [...scene.past, snapshot(scene)],
    future: []
  };
};

export const findObject = (
  objects: SceneObject[],
  selector?: ObjectSelector,
  selectedId?: string | null
): SceneObject | undefined => {
  if (!selector) return selectedId ? objects.find((object) => object.id === selectedId) : lastItem(objects);
  if (selector.mode === 'selected') return selectedId ? objects.find((object) => object.id === selectedId) : lastItem(objects);
  if (selector.mode === 'last') return lastItem(objects);
  if (selector.mode === 'by_name') {
    const name = selector.name ?? '';
    return [...objects].reverse().find((object) => object.name.includes(name) || object.text?.includes(name));
  }
  return [...objects].reverse().find((object) => {
    const shapeMatches = !selector.shape || object.kind === selector.shape;
    const colorMatches = !selector.color || object.style.fill === selector.color || object.style.stroke === selector.color;
    return shapeMatches && colorMatches;
  });
};

const undo = (scene: SceneState): SceneState => {
  const previous = lastItem(scene.past);
  if (!previous) return scene;
  return {
    ...previous,
    past: scene.past.slice(0, -1),
    future: [snapshot(scene), ...scene.future]
  };
};

const redo = (scene: SceneState): SceneState => {
  const next = scene.future[0];
  if (!next) return scene;
  return {
    ...next,
    past: [...scene.past, snapshot(scene)],
    future: scene.future.slice(1)
  };
};

const sceneSnapshotChanged = (before: SceneState, after: SceneState) =>
  before.selectedId !== after.selectedId || JSON.stringify(snapshot(before).objects) !== JSON.stringify(snapshot(after).objects);

const moveObject = (object: SceneObject, direction: DrawingCommand['direction']): SceneObject => {
  const step = 48;
  const positions: Record<NonNullable<DrawingCommand['direction']>, Pick<SceneObject, 'x' | 'y'>> = {
    left: { x: object.x - step, y: object.y },
    right: { x: object.x + step, y: object.y },
    up: { x: object.x, y: object.y - step },
    down: { x: object.x, y: object.y + step },
    center: { x: CANVAS_WIDTH / 2 - object.width / 2, y: CANVAS_HEIGHT / 2 - object.height / 2 },
    'top-left': { x: 72, y: 72 },
    'top-right': { x: CANVAS_WIDTH - object.width - 72, y: 72 },
    'bottom-left': { x: 72, y: CANVAS_HEIGHT - object.height - 72 },
    'bottom-right': { x: CANVAS_WIDTH - object.width - 72, y: CANVAS_HEIGHT - object.height - 72 }
  };
  const next = positions[direction ?? 'center'];
  return {
    ...object,
    x: clamp(next.x, 0, CANVAS_WIDTH - object.width),
    y: clamp(next.y, 0, CANVAS_HEIGHT - object.height)
  };
};

const reorderObject = (
  objects: SceneObject[],
  targetId: string,
  layer: NonNullable<DrawingCommand['layer']>
) => {
  const fromIndex = objects.findIndex((object) => object.id === targetId);
  if (fromIndex < 0) return objects;

  const lastIndex = objects.length - 1;
  const toIndex = {
    front: lastIndex,
    back: 0,
    forward: Math.min(fromIndex + 1, lastIndex),
    backward: Math.max(fromIndex - 1, 0)
  }[layer];

  if (fromIndex === toIndex) return objects;

  const nextObjects = [...objects];
  const [target] = nextObjects.splice(fromIndex, 1);
  nextObjects.splice(toIndex, 0, target);
  return nextObjects;
};

const defaultSize = (kind: ShapeKind) => {
  if (kind === 'line') return { width: 180, height: 8 };
  if (kind === 'text') return { width: 220, height: 64 };
  if (kind === 'triangle') return { width: 150, height: 130 };
  return { width: 140, height: 100 };
};

const shapeName = (kind: ShapeKind) => {
  const names: Record<ShapeKind, string> = {
    circle: '圆形',
    rectangle: '矩形',
    ellipse: '椭圆',
    line: '线条',
    triangle: '三角形',
    text: '文字'
  };
  return names[kind];
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lastItem = <T>(items: T[]) => items.length > 0 ? items[items.length - 1] : undefined;
