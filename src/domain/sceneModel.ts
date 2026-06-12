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

export const applyCommand = (scene: SceneState, command: DrawingCommand): SceneState => {
  switch (command.type) {
    case 'create_object': {
      if (!command.object) return scene;
      const nextObjects = [...scene.objects, command.object];
      return withHistory(scene, { objects: nextObjects, selectedId: command.object.id });
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
      return withHistory(scene, { objects, selectedId: target.id });
    }
    case 'move_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target) return scene;
      const moved = moveObject(target, command.direction);
      const objects = scene.objects.map((object) => (object.id === target.id ? moved : object));
      return withHistory(scene, { objects, selectedId: target.id });
    }
    case 'resize_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target) return scene;
      const scale = command.scale ?? 1;
      const resized = {
        ...target,
        width: clamp(target.width * scale, 20, CANVAS_WIDTH),
        height: clamp(target.height * scale, 20, CANVAS_HEIGHT)
      };
      const objects = scene.objects.map((object) => (object.id === target.id ? resized : object));
      return withHistory(scene, { objects, selectedId: target.id });
    }
    case 'delete_object': {
      const target = findObject(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId);
      if (!target) return scene;
      const objects = scene.objects.filter((object) => object.id !== target.id);
      return withHistory(scene, { objects, selectedId: null });
    }
    case 'clear_canvas':
      return withHistory(scene, { objects: [], selectedId: null });
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

export const findObject = (
  objects: SceneObject[],
  selector?: ObjectSelector,
  selectedId?: string | null
): SceneObject | undefined => {
  if (!selector) return selectedId ? objects.find((object) => object.id === selectedId) : lastItem(objects);
  if (selector.mode === 'selected') return selectedId ? objects.find((object) => object.id === selectedId) : lastItem(objects);
  if (selector.mode === 'last') return lastItem(objects);
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
