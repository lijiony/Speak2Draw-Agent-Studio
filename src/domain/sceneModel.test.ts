import { describe, expect, it } from 'vitest';
import { applyCommand, createEmptyScene, createSceneObject } from './sceneModel';

describe('sceneModel', () => {
  it('支持创建、移动、撤销和重做', () => {
    const circle = createSceneObject('circle', { id: 'shape-1', x: 100, y: 100 });
    const created = applyCommand(createEmptyScene(), { type: 'create_object', object: circle });
    expect(created.objects).toHaveLength(1);

    const moved = applyCommand(created, { type: 'move_object', direction: 'right', selector: { mode: 'selected' } });
    expect(moved.objects[0].x).toBeGreaterThan(created.objects[0].x);

    const undone = applyCommand(moved, { type: 'undo' });
    expect(undone.objects[0].x).toBe(created.objects[0].x);

    const redone = applyCommand(undone, { type: 'redo' });
    expect(redone.objects[0].x).toBe(moved.objects[0].x);
  });

  it('支持清空画布', () => {
    const scene = applyCommand(createEmptyScene(), { type: 'create_object', object: createSceneObject('rectangle', { id: 'shape-1' }) });
    const cleared = applyCommand(scene, { type: 'clear_canvas' });
    expect(cleared.objects).toHaveLength(0);
  });

  it('支持按对象名称选择图形', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('rectangle', { id: 'shape-1', name: '房子墙体' })
    });
    const selected = applyCommand(scene, { type: 'select_object', selector: { mode: 'by_name', name: '房子' } });
    expect(selected.selectedId).toBe('shape-1');
  });

  it('支持调整图层顺序并撤销', () => {
    const base = createEmptyScene();
    const house = createSceneObject('rectangle', { id: 'shape-1', name: '房子墙体' });
    const sun = createSceneObject('circle', { id: 'shape-2', name: '太阳' });
    const created = applyCommand(applyCommand(base, { type: 'create_object', object: house }), {
      type: 'create_object',
      object: sun
    });

    const reordered = applyCommand(created, {
      type: 'reorder_object',
      selector: { mode: 'by_name', name: '房子' },
      layer: 'front'
    });
    expect(reordered.objects.map((object) => object.id)).toEqual(['shape-2', 'shape-1']);
    expect(reordered.selectedId).toBe('shape-1');

    const undone = applyCommand(reordered, { type: 'undo' });
    expect(undone.objects.map((object) => object.id)).toEqual(['shape-1', 'shape-2']);
  });

  it('放大对象时不会越出画布边界', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('rectangle', { id: 'shape-1', x: 900, y: 560, width: 50, height: 35 })
    });
    const resized = applyCommand(scene, { type: 'resize_object', selector: { mode: 'selected' }, scale: 3 });
    const object = resized.objects[0];

    expect(object.x + object.width).toBeLessThanOrEqual(960);
    expect(object.y + object.height).toBeLessThanOrEqual(600);
  });
});
