import type {
  AlignmentMode,
  DistributionAxis,
  DrawingCommand,
  ObjectSelector,
  SceneObject,
  SceneSelection,
  SceneSnapshot,
  SceneState,
  ShapeKind
} from './types';
import { recolorSvgArtworkPart, removeSvgArtworkPart } from './svgArtworkSanitizer';

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 600;

export const createEmptyScene = (): SceneState => ({
  objects: [],
  selectedId: null,
  selection: null,
  revision: 0,
  past: [],
  future: []
});

const snapshot = (scene: SceneState): SceneSnapshot => ({
  objects: scene.objects.map((object) => ({ ...object, style: { ...object.style } })),
  selectedId: scene.selectedId,
  selection: cloneSelection(scene.selection),
  revision: scene.revision
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
    groupId?: string;
    groupName?: string;
    partId?: string;
    partName?: string;
    svgArtwork?: SceneObject['svgArtwork'];
  }
): SceneObject => ({
  id: options.id,
  kind,
  name: options.name ?? shapeName(kind),
  groupId: options.groupId,
  groupName: options.groupName,
  partId: options.partId,
  partName: options.partName,
  x: options.x ?? CANVAS_WIDTH / 2 - 60,
  y: options.y ?? CANVAS_HEIGHT / 2 - 60,
  width: options.width ?? defaultSize(kind).width,
  height: options.height ?? defaultSize(kind).height,
  text: options.text,
  svgArtwork: options.svgArtwork,
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
      return applySnapshot(
        scene,
        {
          objects: nextObjects,
          selectedId: command.object.id,
          selection: selectionForObject(command.object, command.object.groupId ? 'group' : 'part'),
          revision: scene.revision + 1
        },
        recordHistory
      );
    }
    case 'select_object': {
      const target = resolveTarget(scene, command.selector, 'group');
      return target ? { ...scene, selectedId: target.selected.id, selection: target.selection } : scene;
    }
    case 'update_object': {
      const target = resolveTarget(scene, command.selector ?? { mode: 'selected' }, 'group');
      if (!target || !command.updates) return scene;
      const updates = command.updates;
      const targetIds = new Set(target.objects.map((object) => object.id));
      const objects = scene.objects.map((object) =>
        targetIds.has(object.id)
          ? updateSceneObject(object, updates, command.selector, target.selection)
          : object
      );
      return applySnapshot(scene, { objects, selectedId: target.selected.id, selection: target.selection, revision: scene.revision + 1 }, recordHistory);
    }
    case 'move_object': {
      const target = resolveTarget(scene, command.selector ?? { mode: 'selected' }, 'group');
      if (!target) return scene;
      const movedObjects = moveObjectsTogether(target.objects, command.direction);
      const movedById = new Map(movedObjects.map((object) => [object.id, object]));
      const objects = scene.objects.map((object) => movedById.get(object.id) ?? object);
      return applySnapshot(scene, { objects, selectedId: target.selected.id, selection: target.selection, revision: scene.revision + 1 }, recordHistory);
    }
    case 'resize_object': {
      const target = resolveTarget(scene, command.selector ?? { mode: 'selected' }, 'group');
      if (!target) return scene;
      const scale = command.scale ?? 1;
      const resizedObjects = resizeObjectsTogether(target.objects, scale);
      const resizedById = new Map(resizedObjects.map((object) => [object.id, object]));
      const objects = scene.objects.map((object) => resizedById.get(object.id) ?? object);
      return applySnapshot(scene, { objects, selectedId: target.selected.id, selection: target.selection, revision: scene.revision + 1 }, recordHistory);
    }
    case 'reorder_object': {
      const target = resolveTarget(scene, command.selector ?? { mode: 'selected' }, 'group');
      if (!target) return scene;
      const objects = reorderObjects(scene.objects, target.objects, command.layer ?? 'front');
      return objects === scene.objects ? scene : applySnapshot(scene, { objects, selectedId: target.selected.id, selection: target.selection, revision: scene.revision + 1 }, recordHistory);
    }
    case 'group_objects': {
      const targets = findObjects(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId, scene.selection);
      if (targets.length < 2 || !command.groupId) return scene;
      const targetIds = new Set(targets.map((object) => object.id));
      const objects = scene.objects.map((object) =>
        targetIds.has(object.id) ? { ...object, groupId: command.groupId, groupName: command.groupName ?? '素材组' } : object
      );
      const selected = targets[targets.length - 1];
      return applySnapshot(
        scene,
        {
          objects,
          selectedId: selected?.id ?? scene.selectedId,
          selection: command.groupId ? { scope: 'group', groupId: command.groupId, anchorObjectId: selected?.id } : scene.selection,
          revision: scene.revision + 1
        },
        recordHistory
      );
    }
    case 'ungroup_objects': {
      const targets = findObjects(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId, scene.selection);
      if (targets.length === 0) return scene;
      const targetIds = new Set(targets.map((object) => object.id));
      const objects = scene.objects.map((object) =>
        targetIds.has(object.id) ? { ...object, groupId: undefined, groupName: undefined } : object
      );
      const selected = targets[targets.length - 1];
      return applySnapshot(
        scene,
        {
          objects,
          selectedId: selected?.id ?? scene.selectedId,
          selection: selected ? { scope: 'part', objectId: selected.id } : null,
          revision: scene.revision + 1
        },
        recordHistory
      );
    }
    case 'align_objects': {
      const targets = findObjects(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId, scene.selection);
      if (targets.length < 2) return scene;
      const alignedObjects = alignObjects(targets, command.alignment ?? 'center-x');
      const alignedById = new Map(alignedObjects.map((object) => [object.id, object]));
      const objects = scene.objects.map((object) => alignedById.get(object.id) ?? object);
      return applySnapshot(scene, { objects, selectedId: targets[targets.length - 1]?.id ?? scene.selectedId, selection: scene.selection, revision: scene.revision + 1 }, recordHistory);
    }
    case 'distribute_objects': {
      const targets = findObjects(scene.objects, command.selector ?? { mode: 'selected' }, scene.selectedId, scene.selection);
      if (targets.length < 3) return scene;
      const distributedObjects = distributeObjects(targets, command.axis ?? 'horizontal');
      const distributedById = new Map(distributedObjects.map((object) => [object.id, object]));
      const objects = scene.objects.map((object) => distributedById.get(object.id) ?? object);
      return applySnapshot(scene, { objects, selectedId: targets[targets.length - 1]?.id ?? scene.selectedId, selection: scene.selection, revision: scene.revision + 1 }, recordHistory);
    }
    case 'delete_object': {
      const target = resolveTarget(scene, command.selector ?? { mode: 'selected' }, 'group');
      if (!target) return scene;
      if (target.selected.kind === 'svg_artwork' && target.selection.scope === 'part' && target.selected.svgArtwork) {
        const nextArtwork = removeSvgArtworkPart(target.selected.svgArtwork, target.selection.partId ?? target.selection.partName ?? '');
        if (nextArtwork === target.selected.svgArtwork) return scene;
        const objects = scene.objects.map((object) =>
          object.id === target.selected.id ? { ...object, svgArtwork: nextArtwork } : object
        );
        return applySnapshot(
          scene,
          {
            objects,
            selectedId: target.selected.id,
            selection: { scope: 'group', groupId: target.selected.groupId ?? target.selected.id, anchorObjectId: target.selected.id },
            revision: scene.revision + 1
          },
          recordHistory
        );
      }
      const targetIds = new Set(target.objects.map((object) => object.id));
      const objects = scene.objects.filter((object) => !targetIds.has(object.id));
      return applySnapshot(scene, { objects, selectedId: null, selection: null, revision: scene.revision + 1 }, recordHistory);
    }
    case 'clear_canvas':
      return applySnapshot(scene, { objects: [], selectedId: null, selection: null, revision: scene.revision + 1 }, recordHistory);
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
  selectedId?: string | null,
  selection?: SceneSelection | null
): SceneObject | undefined => {
  return resolveTargetFromObjects(objects, selector, selectedId, selection, 'group')?.selected;
};

export const findObjects = (
  objects: SceneObject[],
  selector?: ObjectSelector,
  selectedId?: string | null,
  selection?: SceneSelection | null
): SceneObject[] => {
  if (!selector) return resolveTargetFromObjects(objects, selector, selectedId, selection, 'group')?.objects ?? [];
  if (selector.mode === 'all') return objects;
  if (selector.mode === 'selected' || selector.mode === 'last' || selector.mode === 'by_name' || selector.mode === 'by_id' || selector.mode === 'by_group_id' || selector.mode === 'by_part_name') {
    return resolveTargetFromObjects(objects, selector, selectedId, selection, 'group')?.objects ?? [];
  }
  if (selector.mode === 'by_names') {
    const targetIds = new Set<string>();
    for (const name of selector.names ?? []) {
      const target = resolveTargetFromObjects(objects, { mode: 'by_name', name, scope: selector.scope }, selectedId, selection, selector.scope ?? 'group');
      if (!target) continue;
      for (const related of target.objects) targetIds.add(related.id);
    }
    return objects.filter((object) => targetIds.has(object.id));
  }

  return objects.filter((object) => {
    const shapeMatches = !selector.shape || object.kind === selector.shape;
    const colorMatches = !selector.color || object.style.fill === selector.color || object.style.stroke === selector.color;
    return shapeMatches && colorMatches;
  });
};

type ResolvedTarget = {
  selected: SceneObject;
  objects: SceneObject[];
  selection: SceneSelection;
};

const resolveTarget = (scene: SceneState, selector: ObjectSelector | undefined, defaultScope: 'group' | 'part'): ResolvedTarget | undefined =>
  resolveTargetFromObjects(scene.objects, selector, scene.selectedId, scene.selection, defaultScope);

const resolveTargetFromObjects = (
  objects: SceneObject[],
  selector: ObjectSelector | undefined,
  selectedId: string | null | undefined,
  selection: SceneSelection | null | undefined,
  defaultScope: 'group' | 'part'
): ResolvedTarget | undefined => {
  if (objects.length === 0) return undefined;

  if (!selector || selector.mode === 'selected') {
    if (selector?.scope === 'part') {
      const anchorId = selection?.scope === 'group' ? selection.anchorObjectId : selection?.scope === 'part' ? selection.objectId : selectedId;
      const anchorObject = anchorId ? objects.find((object) => object.id === anchorId) : undefined;
      return anchorObject ? resolveObjectTarget(objects, anchorObject, 'part') : undefined;
    }
    if (selector?.scope === 'group') {
      const selectedTarget = resolveSelection(objects, selection);
      if (selectedTarget) return resolveObjectTarget(objects, selectedTarget.selected, 'group');
    }
    const selectedTarget = resolveSelection(objects, selection);
    if (selectedTarget) return selectedTarget;
    const selectedObject = selectedId ? objects.find((object) => object.id === selectedId) : undefined;
    return selectedObject ? resolveObjectTarget(objects, selectedObject, defaultScope) : resolveObjectTarget(objects, lastItem(objects), defaultScope);
  }

  if (selector.mode === 'last') return resolveObjectTarget(objects, lastItem(objects), selector.scope ?? defaultScope);
  if (selector.mode === 'all') {
    const selected = lastItem(objects);
    return selected ? { selected, objects, selection: selected.groupId ? { scope: 'group', groupId: selected.groupId, anchorObjectId: selected.id } : { scope: 'part', objectId: selected.id } } : undefined;
  }
  if (selector.mode === 'by_id') {
    const target = selector.objectId ? objects.find((object) => object.id === selector.objectId) : undefined;
    return target ? resolveObjectTarget(objects, target, selector.scope ?? 'part') : undefined;
  }
  if (selector.mode === 'by_group_id') {
    const target = selector.groupId ? lastItem(objects.filter((object) => object.groupId === selector.groupId)) : undefined;
    return target ? resolveObjectTarget(objects, target, 'group') : undefined;
  }
  if (selector.mode === 'by_part_name') {
    const artworkTarget = findArtworkPartTarget(objects, selector.name ?? '', selector.withinGroupName);
    if (artworkTarget) {
      return {
        selected: artworkTarget.object,
        objects: [artworkTarget.object],
        selection: {
          scope: 'part',
          objectId: artworkTarget.object.id,
          groupId: artworkTarget.object.groupId,
          partId: artworkTarget.part.id,
          partName: artworkTarget.part.partName
        }
      };
    }
    const target = findPartByName(objects, selector.name ?? '', selector.withinGroupName);
    return target ? resolveObjectTarget(objects, target, 'part') : undefined;
  }
  if (selector.mode === 'by_name') {
    const artworkTarget = findArtworkPartTarget(objects, selector.name ?? '');
    if ((selector.scope === 'part' || hasPartSignal(selector.name ?? '')) && artworkTarget) {
      return resolveArtworkPartTarget(artworkTarget.object, artworkTarget.part);
    }
    const named = resolveNamedTarget(objects, selector.name ?? '', selector.scope);
    if (!named) return undefined;
    return resolveObjectTarget(objects, named.object, named.scope);
  }
  if (selector.mode === 'by_names') return resolveTargetFromObjects(objects, { mode: 'by_name', name: lastItem(selector.names ?? []), scope: selector.scope }, selectedId, selection, selector.scope ?? defaultScope);

  const target = [...objects].reverse().find((object) => {
    const shapeMatches = !selector.shape || object.kind === selector.shape;
    const colorMatches = !selector.color || object.style.fill === selector.color || object.style.stroke === selector.color;
    return shapeMatches && colorMatches;
  });
  return target ? resolveObjectTarget(objects, target, selector.scope ?? defaultScope) : undefined;
};

const resolveSelection = (objects: SceneObject[], selection: SceneSelection | null | undefined): ResolvedTarget | undefined => {
  if (!selection) return undefined;
  if (selection.scope === 'group') {
    const groupObjects = objects.filter((object) => object.groupId === selection.groupId);
    const selected = groupObjects.find((object) => object.id === selection.anchorObjectId) ?? lastItem(groupObjects);
    return selected ? { selected, objects: groupObjects, selection } : undefined;
  }

  const selected = objects.find((object) => object.id === selection.objectId);
  if (!selected) return undefined;
  if (selected.kind === 'svg_artwork' && selection.partId) return { selected, objects: [selected], selection };
  const partObjects = selected.partId ? objects.filter((object) => object.partId === selected.partId) : [selected];
  return { selected, objects: partObjects, selection };
};

const resolveObjectTarget = (
  objects: SceneObject[],
  object: SceneObject | undefined,
  requestedScope: 'group' | 'part'
): ResolvedTarget | undefined => {
  if (!object) return undefined;
  if (requestedScope === 'group' && object.groupId) {
    const groupObjects = objects.filter((item) => item.groupId === object.groupId);
    return {
      selected: object,
      objects: groupObjects,
      selection: { scope: 'group', groupId: object.groupId, anchorObjectId: object.id }
    };
  }

  if (requestedScope === 'part' && object.partId) {
    const partObjects = objects.filter((item) => item.partId === object.partId);
    return {
      selected: object,
      objects: partObjects,
      selection: { scope: 'part', objectId: object.id, groupId: object.groupId }
    };
  }

  if (requestedScope === 'part' && object.kind === 'svg_artwork') {
    const part = object.svgArtwork?.parts[0];
    return {
      selected: object,
      objects: [object],
      selection: { scope: 'part', objectId: object.id, groupId: object.groupId, partId: part?.id, partName: part?.partName }
    };
  }

  return {
    selected: object,
    objects: [object],
    selection: { scope: 'part', objectId: object.id, groupId: object.groupId }
  };
};

const selectionForObject = (object: SceneObject, requestedScope: 'group' | 'part'): SceneSelection =>
  requestedScope === 'group' && object.groupId
    ? { scope: 'group', groupId: object.groupId, anchorObjectId: object.id }
    : object.kind === 'svg_artwork'
      ? { scope: 'group', groupId: object.groupId ?? object.id, anchorObjectId: object.id }
      : { scope: 'part', objectId: object.id, groupId: object.groupId };

const resolveNamedTarget = (
  objects: SceneObject[],
  name: string,
  forcedScope?: 'group' | 'part'
): { object: SceneObject; scope: 'group' | 'part' } | undefined => {
  const query = name.trim();
  if (!query) return undefined;

  const exactPart = [...objects].reverse().find((object) => object.name === query || object.partName === query || object.svgArtwork?.parts.some((part) => nameMatches(part.partName, query)));
  const exactGroup = [...objects].reverse().find((object) => object.groupName === query);
  const part = findPartByName(objects, query);
  const group = [...objects].reverse().find((object) => nameMatches(object.groupName, query));

  if (forcedScope === 'part') return (part ?? exactPart ?? group) ? { object: part ?? exactPart ?? group!, scope: 'part' } : undefined;
  if (forcedScope === 'group') return (group ?? exactGroup ?? part) ? { object: group ?? exactGroup ?? part!, scope: 'group' } : undefined;

  if (hasPartSignal(query) && (exactPart ?? part)) return { object: exactPart ?? part!, scope: 'part' };
  if (exactGroup) return { object: exactGroup, scope: 'group' };
  if (group) return { object: group, scope: 'group' };
  if (exactPart ?? part) {
    const object = exactPart ?? part!;
    return { object, scope: object.groupId ? 'group' : 'part' };
  }

  return undefined;
};

const findPartByName = (objects: SceneObject[], name: string, withinGroupName?: string) =>
  [...objects]
    .reverse()
    .find((object) => {
      const groupMatches = !withinGroupName || nameMatches(object.groupName, withinGroupName);
      return groupMatches && (nameMatches(object.name, name) || nameMatches(object.partName, name) || object.svgArtwork?.parts.some((part) => nameMatches(part.partName, name)));
    });

const findArtworkPartTarget = (objects: SceneObject[], name: string, withinGroupName?: string) => {
  for (const object of [...objects].reverse()) {
    if (object.kind !== 'svg_artwork' || !object.svgArtwork) continue;
    if (withinGroupName && !nameMatches(object.groupName ?? object.name, withinGroupName)) continue;
    const part = object.svgArtwork.parts.find((part) => nameMatches(part.partName, name));
    if (part) return { object, part };
  }
  return undefined;
};

const resolveArtworkPartTarget = (object: SceneObject, part: NonNullable<SceneObject['svgArtwork']>['parts'][number]): ResolvedTarget => ({
  selected: object,
  objects: [object],
  selection: {
    scope: 'part',
    objectId: object.id,
    groupId: object.groupId,
    partId: part.id,
    partName: part.partName
  }
});

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

const updateSceneObject = (
  object: SceneObject,
  updates: NonNullable<DrawingCommand['updates']>,
  selector: DrawingCommand['selector'],
  selection: SceneSelection
): SceneObject => {
  if (object.kind === 'svg_artwork' && object.svgArtwork && selection.scope === 'part' && updates.style?.fill) {
    return {
      ...object,
      svgArtwork: recolorSvgArtworkPart(object.svgArtwork, selection.partId ?? selection.partName ?? selector?.name ?? '', updates.style.fill),
      style: updates.style ? { ...object.style, ...updates.style } : object.style
    };
  }

  return {
    ...object,
    ...updates,
    style: updates.style ? { ...object.style, ...updates.style } : object.style
  };
};

const sceneSnapshotChanged = (before: SceneState, after: SceneState) =>
  before.selectedId !== after.selectedId ||
  JSON.stringify(before.selection) !== JSON.stringify(after.selection) ||
  JSON.stringify(snapshot(before).objects) !== JSON.stringify(snapshot(after).objects);

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

const moveObjectsTogether = (objects: SceneObject[], direction: DrawingCommand['direction']): SceneObject[] => {
  if (objects.length <= 1) return objects.map((object) => moveObject(object, direction));

  const bounds = getBounds(objects);
  const step = 48;
  const desired: Pick<SceneObject, 'x' | 'y'> = {
    left: { x: bounds.x - step, y: bounds.y },
    right: { x: bounds.x + step, y: bounds.y },
    up: { x: bounds.x, y: bounds.y - step },
    down: { x: bounds.x, y: bounds.y + step },
    center: { x: CANVAS_WIDTH / 2 - bounds.width / 2, y: CANVAS_HEIGHT / 2 - bounds.height / 2 },
    'top-left': { x: 72, y: 72 },
    'top-right': { x: CANVAS_WIDTH - bounds.width - 72, y: 72 },
    'bottom-left': { x: 72, y: CANVAS_HEIGHT - bounds.height - 72 },
    'bottom-right': { x: CANVAS_WIDTH - bounds.width - 72, y: CANVAS_HEIGHT - bounds.height - 72 }
  }[direction ?? 'center'];
  const nextX = clamp(desired.x, 0, CANVAS_WIDTH - bounds.width);
  const nextY = clamp(desired.y, 0, CANVAS_HEIGHT - bounds.height);
  const dx = nextX - bounds.x;
  const dy = nextY - bounds.y;

  return objects.map((object) => ({ ...object, x: object.x + dx, y: object.y + dy }));
};

const resizeObjectsTogether = (objects: SceneObject[], scale: number): SceneObject[] => {
  if (objects.length <= 1) {
    const object = objects[0];
    return object
      ? [
          {
            ...object,
            width: clamp(object.width * scale, 20, CANVAS_WIDTH - object.x),
            height: clamp(object.height * scale, 20, CANVAS_HEIGHT - object.y)
          }
        ]
      : [];
  }

  const bounds = getBounds(objects);
  const safeScale = clamp(scale, 0.2, Math.min(CANVAS_WIDTH / bounds.width, CANVAS_HEIGHT / bounds.height, 4));
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const resized = objects.map((object) => ({
    ...object,
    x: centerX + (object.x - centerX) * safeScale,
    y: centerY + (object.y - centerY) * safeScale,
    width: clamp(object.width * safeScale, 20, CANVAS_WIDTH),
    height: clamp(object.height * safeScale, 20, CANVAS_HEIGHT)
  }));
  const resizedBounds = getBounds(resized);
  const dx = clamp(resizedBounds.x, 0, CANVAS_WIDTH - resizedBounds.width) - resizedBounds.x;
  const dy = clamp(resizedBounds.y, 0, CANVAS_HEIGHT - resizedBounds.height) - resizedBounds.y;

  return resized.map((object) => ({ ...object, x: object.x + dx, y: object.y + dy }));
};

const reorderObjects = (
  objects: SceneObject[],
  targets: SceneObject[],
  layer: NonNullable<DrawingCommand['layer']>
) => {
  if (targets.length <= 1) return reorderObject(objects, targets[0]?.id, layer);

  const targetIds = new Set(targets.map((object) => object.id));
  const block = objects.filter((object) => targetIds.has(object.id));
  const rest = objects.filter((object) => !targetIds.has(object.id));
  const firstIndex = objects.findIndex((object) => targetIds.has(object.id));
  const lastIndex = lastIndexMatching(objects, (object) => targetIds.has(object.id));

  if (layer === 'front') return [...rest, ...block];
  if (layer === 'back') return [...block, ...rest];

  const insertIndex =
    layer === 'forward'
      ? Math.min(rest.length, objects.slice(0, lastIndex + 2).filter((object) => !targetIds.has(object.id)).length)
      : Math.max(0, objects.slice(0, firstIndex - 1).filter((object) => !targetIds.has(object.id)).length);
  const nextObjects = [...rest];
  nextObjects.splice(insertIndex, 0, ...block);
  return nextObjects;
};

const reorderObject = (objects: SceneObject[], targetId: string | undefined, layer: NonNullable<DrawingCommand['layer']>) => {
  if (!targetId) return objects;
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

const alignObjects = (objects: SceneObject[], alignment: AlignmentMode): SceneObject[] => {
  const bounds = getBounds(objects);
  return objects.map((object) => {
    const next = { x: object.x, y: object.y };
    if (alignment === 'left') next.x = bounds.x;
    if (alignment === 'right') next.x = bounds.x + bounds.width - object.width;
    if (alignment === 'center-x') next.x = bounds.x + bounds.width / 2 - object.width / 2;
    if (alignment === 'top') next.y = bounds.y;
    if (alignment === 'bottom') next.y = bounds.y + bounds.height - object.height;
    if (alignment === 'center-y') next.y = bounds.y + bounds.height / 2 - object.height / 2;
    return {
      ...object,
      x: clamp(next.x, 0, CANVAS_WIDTH - object.width),
      y: clamp(next.y, 0, CANVAS_HEIGHT - object.height)
    };
  });
};

const distributeObjects = (objects: SceneObject[], axis: DistributionAxis): SceneObject[] => {
  const center = (object: SceneObject) => axis === 'horizontal' ? object.x + object.width / 2 : object.y + object.height / 2;
  const sorted = [...objects].sort((a, b) => center(a) - center(b));
  const first = center(sorted[0]);
  const last = center(sorted[sorted.length - 1]);
  const gap = (last - first) / (sorted.length - 1);

  return sorted.map((object, index) => {
    const nextCenter = first + gap * index;
    if (axis === 'horizontal') {
      return { ...object, x: clamp(nextCenter - object.width / 2, 0, CANVAS_WIDTH - object.width) };
    }
    return { ...object, y: clamp(nextCenter - object.height / 2, 0, CANVAS_HEIGHT - object.height) };
  });
};

const defaultSize = (kind: ShapeKind) => {
  if (kind === 'svg_artwork') return { width: CANVAS_WIDTH - 192, height: CANVAS_HEIGHT - 96 };
  if (kind === 'line') return { width: 180, height: 8 };
  if (kind === 'text') return { width: 220, height: 64 };
  if (kind === 'triangle') return { width: 150, height: 130 };
  return { width: 140, height: 100 };
};

const getBounds = (objects: SceneObject[]) => {
  const minX = Math.min(...objects.map((object) => object.x));
  const minY = Math.min(...objects.map((object) => object.y));
  const maxX = Math.max(...objects.map((object) => object.x + object.width));
  const maxY = Math.max(...objects.map((object) => object.y + object.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
};

const lastIndexMatching = <T>(items: T[], predicate: (item: T) => boolean) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
};

const shapeName = (kind: ShapeKind) => {
  const names: Record<ShapeKind, string> = {
    circle: '圆形',
    rectangle: '矩形',
    ellipse: '椭圆',
    line: '线条',
    triangle: '三角形',
    text: '文字',
    svg_artwork: 'AI SVG 插画'
  };
  return names[kind];
};

const nameMatches = (value: string | undefined, query: string) =>
  Boolean(value && query && (value.includes(query) || query.includes(value)));

const hasPartSignal = (query: string) =>
  /(窗户|窗|门|屋顶|墙|帽子|帽檐|眼|耳|鼻|脸|头|身体|手|脚|腿|轮|叶|树干|树冠|部件|局部)/.test(query);

const cloneSelection = (selection: SceneSelection | null): SceneSelection | null =>
  selection ? { ...selection } : null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lastItem = <T>(items: T[]) => items.length > 0 ? items[items.length - 1] : undefined;
