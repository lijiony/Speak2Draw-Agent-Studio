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
});
