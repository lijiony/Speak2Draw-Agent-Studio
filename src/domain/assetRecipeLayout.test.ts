import { describe, expect, it } from 'vitest';
import { layoutAssetRecipe } from './assetRecipeLayout';
import { applyCommandsAsTransaction, createEmptyScene, createSceneObject } from './sceneModel';
import type { DrawingRecipeItem } from './types';

const expectInsideCanvas = (items: ReturnType<typeof layoutAssetRecipe>['items']) => {
  for (const item of items) {
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.x + item.width).toBeLessThanOrEqual(960);
    expect(item.y + item.height).toBeLessThanOrEqual(600);
  }
};

const byPart = (items: ReturnType<typeof layoutAssetRecipe>['items'], partName: string) =>
  items.find((item) => item.item.partName === partName || item.name.includes(partName));

describe('assetRecipeLayout', () => {
  it('按 slot 和 relativeTo 把戴帽子的小猫布局成可编辑部件', () => {
    const recipe: DrawingRecipeItem[] = [
      { shape: 'circle', name: '小猫脸', partName: '脸', slot: 'center', size: 'large', color: '#f8fafc' },
      { shape: 'triangle', name: '左耳', partName: '耳朵', slot: 'top-left', relativeTo: '脸', size: 'small', color: '#f8fafc' },
      { shape: 'triangle', name: '右耳', partName: '耳朵', slot: 'top-right', relativeTo: '脸', size: 'small', color: '#f8fafc' },
      { shape: 'circle', name: '左眼', partName: '眼睛', slot: 'left', relativeTo: '脸', size: 'tiny', color: '#111827' },
      { shape: 'circle', name: '右眼', partName: '眼睛', slot: 'right', relativeTo: '脸', size: 'tiny', color: '#111827' },
      { shape: 'triangle', name: '鼻子', partName: '鼻子', slot: 'bottom', relativeTo: '脸', size: 'tiny', color: '#ec4899' },
      { shape: 'rectangle', name: '帽檐', partName: '帽子', slot: 'top', relativeTo: '脸', size: 'small', color: '#ef4444' }
    ];

    const result = layoutAssetRecipe({ recipe, scene: createEmptyScene(), groupName: '戴帽子的小猫', schemaVersion: '2.0' });
    const face = byPart(result.items, '脸');
    const hat = byPart(result.items, '帽子');
    const eye = byPart(result.items, '眼睛');

    expect(result.items).toHaveLength(7);
    expectInsideCanvas(result.items);
    expect(result.diagnostics.acceptedCount).toBe(7);
    expect(result.diagnostics.parts.map((part) => part.slot)).toContain('top');
    expect(face).toBeTruthy();
    expect(hat).toBeTruthy();
    expect(eye).toBeTruthy();
    expect(hat!.y).toBeLessThan(face!.y);
    expect(eye!.x).toBeGreaterThan(face!.x);
    expect(eye!.x + eye!.width).toBeLessThan(face!.x + face!.width);
  });

  it('AI 返回相同 position 时仍根据 slot 重新排版', () => {
    const recipe: DrawingRecipeItem[] = [
      { shape: 'circle', name: '花心', partName: '花蕊', slot: 'center', position: { x: 100, y: 100 }, size: 'small', color: '#facc15' },
      { shape: 'ellipse', name: '上花瓣', partName: '花瓣', slot: 'top', position: { x: 100, y: 100 }, size: 'small', color: '#ec4899' },
      { shape: 'ellipse', name: '下花瓣', partName: '花瓣', slot: 'bottom', position: { x: 100, y: 100 }, size: 'small', color: '#ec4899' },
      { shape: 'ellipse', name: '左花瓣', partName: '花瓣', slot: 'left', position: { x: 100, y: 100 }, size: 'small', color: '#ec4899' },
      { shape: 'ellipse', name: '右花瓣', partName: '花瓣', slot: 'right', position: { x: 100, y: 100 }, size: 'small', color: '#ec4899' }
    ];

    const result = layoutAssetRecipe({ recipe, scene: createEmptyScene(), groupName: '花朵' });
    const centers = new Set(result.items.map((item) => `${Math.round(item.x + item.width / 2)}:${Math.round(item.y + item.height / 2)}`));

    expect(result.items).toHaveLength(5);
    expect(centers.size).toBeGreaterThan(3);
    expectInsideCanvas(result.items);
  });

  it('局部替换会贴近原素材组并保留安全边界', () => {
    const scene = applyCommandsAsTransaction(createEmptyScene(), [
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-face', name: '小猫脸', groupId: 'asset-cat', groupName: '小猫', partId: 'part-face', partName: '脸', x: 390, y: 230, width: 150, height: 130 })
      },
      {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-hat', name: '小猫帽子', groupId: 'asset-cat', groupName: '小猫', partId: 'part-hat', partName: '帽子', x: 420, y: 190, width: 90, height: 40 })
      }
    ]);
    const target = scene.objects.find((object) => object.partName === '帽子');
    const result = layoutAssetRecipe({
      scene,
      groupName: '小猫',
      groupId: 'asset-cat',
      placementTarget: target,
      recipe: [{ shape: 'rectangle', name: '蓝帽子', partName: '帽子', relativeTo: '脸', slot: 'top', size: 'small', color: '#2563eb' }]
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].y).toBeLessThan(scene.objects[0].y);
    expect(result.items[0].x).toBeGreaterThan(320);
    expect(result.items[0].x).toBeLessThan(560);
    expectInsideCanvas(result.items);
  });

  it('船、花瓶和云朵配方会生成画布内布局诊断', () => {
    const recipes: DrawingRecipeItem[][] = [
      [
        { shape: 'rectangle', name: '船身', partName: '船身', slot: 'bottom', size: 'large', color: '#92400e' },
        { shape: 'triangle', name: '船帆', partName: '帆', relativeTo: '船身', slot: 'top', size: 'large', color: '#f8fafc' }
      ],
      [
        { shape: 'rectangle', name: '花瓶', partName: '花瓶', slot: 'bottom', size: 'medium', color: '#60a5fa' },
        { shape: 'line', name: '花茎', partName: '花茎', relativeTo: '花瓶', slot: 'top', size: 'medium', color: '#16a34a' },
        { shape: 'circle', name: '花朵', partName: '花朵', relativeTo: '花茎', slot: 'top', size: 'small', color: '#ec4899' }
      ],
      [
        { shape: 'ellipse', name: '云朵左', partName: '云朵', slot: 'left', size: 'medium', color: '#e0f2fe' },
        { shape: 'ellipse', name: '云朵中', partName: '云朵', slot: 'center', size: 'large', color: '#e0f2fe' },
        { shape: 'ellipse', name: '云朵右', partName: '云朵', slot: 'right', size: 'medium', color: '#e0f2fe' }
      ]
    ];

    for (const recipe of recipes) {
      const result = layoutAssetRecipe({ recipe, scene: createEmptyScene(), groupName: '测试素材' });
      expect(result.diagnostics.commandCount).toBe(recipe.length);
      expect(result.diagnostics.bounds.width).toBeGreaterThan(0);
      expect(result.diagnostics.bounds.height).toBeGreaterThan(0);
      expectInsideCanvas(result.items);
    }
  });
});
