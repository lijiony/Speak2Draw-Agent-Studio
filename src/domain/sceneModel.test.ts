import { describe, expect, it } from 'vitest';
import { applyCommand, applyCommandsAsTransaction, createEmptyScene, createSceneObject } from './sceneModel';

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

  it('支持把多步命令作为一次历史事务撤销和重做', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      { type: 'create_object', object: createSceneObject('rectangle', { id: 'shape-1', name: '房子墙体' }) },
      { type: 'create_object', object: createSceneObject('circle', { id: 'shape-2', name: '太阳' }) }
    ]);

    expect(scene.objects).toHaveLength(2);
    expect(scene.past).toHaveLength(1);

    const undone = applyCommand(scene, { type: 'undo' });
    expect(undone.objects).toHaveLength(0);
    expect(undone.future).toHaveLength(1);

    const redone = applyCommand(undone, { type: 'redo' });
    expect(redone.objects.map((object) => object.name)).toEqual(['房子墙体', '太阳']);
  });

  it('支持按对象名称选择图形', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('rectangle', { id: 'shape-1', name: '房子墙体' })
    });
    const selected = applyCommand(scene, { type: 'select_object', selector: { mode: 'by_name', name: '房子' } });
    expect(selected.selectedId).toBe('shape-1');
  });

  it('支持按素材组名称选择并移动整组图形', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '猫脸', groupId: 'asset-1', groupName: '猫', x: 300, y: 220 })
      },
      {
        type: 'create_object',
        object: createSceneObject('triangle', { id: 'shape-2', name: '猫左耳', groupId: 'asset-1', groupName: '猫', x: 300, y: 180 })
      }
    ]);

    const selected = applyCommand(scene, { type: 'select_object', selector: { mode: 'by_name', name: '猫' } });
    const selectedByLongName = applyCommand(scene, { type: 'select_object', selector: { mode: 'by_name', name: '戴帽子的猫' } });
    const moved = applyCommand(selected, { type: 'move_object', selector: { mode: 'by_name', name: '猫' }, direction: 'right' });

    expect(selected.selectedId).toBe('shape-2');
    expect(selectedByLongName.selectedId).toBe('shape-2');
    expect(moved.objects.map((object) => object.x)).toEqual([348, 348]);
  });

  it('支持按素材组名称改色和删除整组图形', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '猫脸', groupId: 'asset-1', groupName: '猫', fill: '#f9fafb' })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-2', name: '猫帽子', groupId: 'asset-1', groupName: '猫', fill: '#ef4444' })
      }
    ]);

    const updated = applyCommand(scene, {
      type: 'update_object',
      selector: { mode: 'by_name', name: '猫' },
      updates: { style: { fill: '#ec4899' } }
    });
    const deleted = applyCommand(updated, { type: 'delete_object', selector: { mode: 'by_name', name: '猫' } });

    expect(updated.objects.map((object) => object.style.fill)).toEqual(['#ec4899', '#ec4899']);
    expect(deleted.objects).toHaveLength(0);
  });

  it('支持把多个对象成组并取消成组', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-1', name: '月亮' })
      },
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-2', name: '太阳' })
      }
    ]);

    const grouped = applyCommand(scene, {
      type: 'group_objects',
      selector: { mode: 'by_names', names: ['月亮', '太阳'] },
      groupId: 'asset-voice-1',
      groupName: '夜空'
    });
    expect(grouped.objects.map((object) => object.groupName)).toEqual(['夜空', '夜空']);

    const moved = applyCommand(grouped, { type: 'move_object', selector: { mode: 'by_name', name: '夜空' }, direction: 'right' });
    expect(moved.objects[0].x).toBeGreaterThan(grouped.objects[0].x);
    expect(moved.objects[1].x).toBeGreaterThan(grouped.objects[1].x);

    const ungrouped = applyCommand(moved, { type: 'ungroup_objects', selector: { mode: 'by_name', name: '夜空' } });
    expect(ungrouped.objects.map((object) => object.groupName)).toEqual([undefined, undefined]);
  });

  it('支持对齐和均匀分布多个对象', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-1', name: '左', x: 20, y: 100, width: 20, height: 20 })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-2', name: '右', x: 300, y: 180, width: 20, height: 20 })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-3', name: '中', x: 100, y: 240, width: 20, height: 20 })
      }
    ]);

    const aligned = applyCommand(scene, { type: 'align_objects', selector: { mode: 'all' }, alignment: 'left' });
    expect(aligned.objects.map((object) => object.x)).toEqual([20, 20, 20]);

    const distributed = applyCommand(scene, { type: 'distribute_objects', selector: { mode: 'all' }, axis: 'horizontal' });
    expect(distributed.objects.map((object) => object.x)).toEqual([20, 300, 160]);
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
