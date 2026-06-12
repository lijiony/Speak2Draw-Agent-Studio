import { describe, expect, it } from 'vitest';
import { applyCommand, createEmptyScene, createSceneObject } from './sceneModel';
import { serializeSceneToSvg } from './svgExport';

describe('serializeSceneToSvg', () => {
  it('按场景对象顺序导出 SVG，保证图层一致', () => {
    const base = createEmptyScene();
    const scene = applyCommand(
      applyCommand(base, {
        type: 'create_object',
        object: createSceneObject('rectangle', { id: 'shape-1', name: '房子墙体', fill: '#fef3c7' })
      }),
      {
        type: 'create_object',
        object: createSceneObject('circle', { id: 'shape-2', name: '太阳', fill: '#facc15' })
      }
    );

    const reordered = applyCommand(scene, {
      type: 'reorder_object',
      selector: { mode: 'by_name', name: '房子' },
      layer: 'front'
    });
    const svg = serializeSceneToSvg(reordered);

    expect(svg.indexOf('<circle')).toBeLessThan(svg.indexOf('<rect x='));
  });
});
