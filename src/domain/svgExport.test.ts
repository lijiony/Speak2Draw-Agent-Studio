import { describe, expect, it } from 'vitest';
import { applyCommand, createEmptyScene, createSceneObject } from './sceneModel';
import { serializeSceneToSvg } from './svgExport';
import type { SvgArtworkData } from './types';

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

  it('导出安全 SVG 插画时只使用清洗后的内容', () => {
    const artwork: SvgArtworkData = {
      name: '安全小猫',
      viewBox: '0 0 960 600',
      safeMarkup: '<g id="cat-hat" data-part-name="帽子"><rect x="420" y="120" width="120" height="70" fill="#2563eb"/></g>',
      parts: [{ id: 'cat-hat', partName: '帽子', editable: true }],
      diagnostics: {
        generationMode: 'safe-svg-artwork',
        sanitizerStatus: 'accepted',
        sanitizedElementCount: 2,
        droppedElementCount: 1,
        droppedAttributeCount: 1,
        partCount: 1,
        safeMarkupLength: 112,
        warnings: ['已丢弃不安全 SVG 标签：script']
      }
    };
    const scene = applyCommand(createEmptyScene(), {
      type: 'create_object',
      object: createSceneObject('svg_artwork', {
        id: 'artwork-1',
        name: '安全小猫',
        x: 96,
        y: 48,
        width: 768,
        height: 504,
        svgArtwork: artwork
      })
    });

    const svg = serializeSceneToSvg(scene);

    expect(svg).toContain('data-kind="safe-svg-artwork"');
    expect(svg).toContain('cat-hat');
    expect(svg).toContain('scale(0.8 0.84)');
    expect(svg).not.toMatch(/script|onload|foreignObject|href=/i);
  });
});
