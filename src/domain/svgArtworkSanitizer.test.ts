import { describe, expect, it } from 'vitest';
import { SVG_ARTWORK_SCHEMA_VERSION, type SvgArtworkPayload } from '../ai/svgArtworkContract';
import { recolorSvgArtworkPart, removeSvgArtworkPart, sanitizeSvgArtwork } from './svgArtworkSanitizer';

const payload = (svg: string, parts: SvgArtworkPayload['parts'] = [{ id: 'cat-hat', partName: '帽子', role: 'accessory', editable: true }]): SvgArtworkPayload => ({
  schemaVersion: SVG_ARTWORK_SCHEMA_VERSION,
  name: '戴帽子的小猫',
  viewBox: '0 0 960 600',
  svg,
  parts,
  qualityNotes: '可爱贴纸风。'
});

describe('svgArtworkSanitizer', () => {
  it('接受安全 SVG 并保留局部 manifest', () => {
    const result = sanitizeSvgArtwork(
      payload(`
        <svg viewBox="0 0 960 600">
          <defs><linearGradient id="hat-grad"><stop offset="0%" stop-color="#2563eb"/></linearGradient></defs>
          <g id="cat-hat" data-part-name="帽子" data-role="accessory">
            <path d="M420 190 L520 190 L490 140 Z" fill="url(#hat-grad)" stroke="#111827" stroke-width="4"/>
          </g>
          <circle id="cat-face" data-part-name="脸" cx="480" cy="300" r="90" fill="#f8fafc"/>
        </svg>
      `)
    );

    expect(result.ok).toBe(true);
    expect(result.artwork?.safeMarkup).toContain('cat-hat');
    expect(result.artwork?.safeMarkup).toContain('linearGradient');
    expect(result.artwork?.parts).toHaveLength(1);
    expect(result.diagnostics.sanitizerStatus).toBe('accepted');
  });

  it('丢弃危险标签和事件属性', () => {
    const result = sanitizeSvgArtwork(
      payload(`
        <svg viewBox="0 0 960 600" onload="alert(1)">
          <script>alert(1)</script>
          <foreignObject><div>bad</div></foreignObject>
          <g id="cat-hat" data-part-name="帽子" onclick="alert(1)">
            <rect x="420" y="140" width="100" height="70" fill="#2563eb" onmouseover="alert(1)"/>
          </g>
        </svg>
      `)
    );

    expect(result.ok).toBe(true);
    expect(result.artwork?.safeMarkup).not.toMatch(/script|foreignObject|image|onload|onclick|onmouseover|https:/i);
    expect(result.diagnostics.droppedElementCount).toBeGreaterThan(0);
    expect(result.diagnostics.droppedAttributeCount).toBeGreaterThan(0);
  });

  it('移除不安全 URL 属性但保留可清洗 SVG', () => {
    const result = sanitizeSvgArtwork(payload('<svg viewBox="0 0 960 600"><g id="cat-hat" data-part-name="帽子"><rect x="1" y="1" width="80" height="40" fill="url(http://evil)"/></g></svg>'));

    expect(result.ok).toBe(true);
    expect(result.artwork?.safeMarkup).toContain('cat-hat');
    expect(result.artwork?.safeMarkup).not.toContain('http://evil');
    expect(result.diagnostics.droppedAttributeCount).toBeGreaterThan(0);
    expect(result.diagnostics.warnings).toContain('已移除不安全 URL 属性：fill');
  });

  it('拒绝异常 viewBox', () => {
    expect(sanitizeSvgArtwork({ ...payload('<svg viewBox="0 0 960 600"></svg>'), viewBox: '0 0 999999 600' }).ok).toBe(false);
  });

  it('拒绝超长 path 和没有 manifest 命中的 SVG', () => {
    const longPath = `M ${Array.from({ length: 5000 }, (_, index) => `${index} ${index}`).join(' L ')}`;
    expect(sanitizeSvgArtwork(payload(`<svg viewBox="0 0 960 600"><path id="cat-hat" data-part-name="帽子" d="${longPath}"/></svg>`)).ok).toBe(false);
    expect(sanitizeSvgArtwork(payload('<svg viewBox="0 0 960 600"><rect id="other" x="1" y="1" width="80" height="40"/></svg>')).ok).toBe(false);
  });

  it('支持按 manifest 删除和改色局部', () => {
    const result = sanitizeSvgArtwork(
      payload('<svg viewBox="0 0 960 600"><g id="cat-hat" data-part-name="帽子"><rect x="420" y="140" width="100" height="70" fill="#ef4444"/></g><circle id="cat-face" data-part-name="脸" cx="480" cy="300" r="90" fill="#f8fafc"/></svg>', [
        { id: 'cat-hat', partName: '帽子', editable: true },
        { id: 'cat-face', partName: '脸', editable: true }
      ])
    );
    expect(result.ok).toBe(true);

    const recolored = recolorSvgArtworkPart(result.artwork!, '帽子', '#2563eb');
    expect(recolored.safeMarkup).toContain('#2563eb');
    const removed = removeSvgArtworkPart(recolored, '帽子');
    expect(removed.safeMarkup).not.toContain('cat-hat');
    expect(removed.safeMarkup).toContain('cat-face');
    expect(removed.parts.map((part) => part.partName)).toEqual(['脸']);
  });
});
