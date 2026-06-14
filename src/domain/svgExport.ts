import { CANVAS_HEIGHT, CANVAS_WIDTH } from './sceneModel';
import type { SceneObject, SceneState } from './types';

export const serializeSceneToSvg = (scene: SceneState) => {
  const objects = scene.objects.map(renderObjectToMarkup).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${objects}
</svg>`;
};

const renderObjectToMarkup = (object: SceneObject) => {
  const style = `fill="${escapeAttr(object.style.fill)}" stroke="${escapeAttr(object.style.stroke)}" stroke-width="${object.style.strokeWidth}"`;
  if (object.kind === 'svg_artwork' && object.svgArtwork) {
    const [viewX, viewY, viewWidth, viewHeight] = parseViewBox(object.svgArtwork.viewBox);
    const scaleX = object.width / viewWidth;
    const scaleY = object.height / viewHeight;
    return `<g data-kind="safe-svg-artwork" data-name="${escapeAttr(object.svgArtwork.name)}" transform="translate(${object.x} ${object.y}) scale(${scaleX} ${scaleY}) translate(${-viewX} ${-viewY})">
    ${object.svgArtwork.safeMarkup}
  </g>`;
  }
  if (object.kind === 'circle') {
    const radius = Math.min(object.width, object.height) / 2;
    return `<circle cx="${object.x + radius}" cy="${object.y + radius}" r="${radius}" ${style}/>`;
  }
  if (object.kind === 'ellipse') {
    return `<ellipse cx="${object.x + object.width / 2}" cy="${object.y + object.height / 2}" rx="${object.width / 2}" ry="${object.height / 2}" ${style}/>`;
  }
  if (object.kind === 'line') {
    return `<line x1="${object.x}" y1="${object.y}" x2="${object.x + object.width}" y2="${object.y + object.height}" stroke="${escapeAttr(object.style.stroke)}" stroke-width="${object.style.strokeWidth}" stroke-linecap="round"/>`;
  }
  if (object.kind === 'triangle') {
    const points = `${object.x + object.width / 2},${object.y} ${object.x + object.width},${object.y + object.height} ${object.x},${object.y + object.height}`;
    return `<polygon points="${points}" ${style}/>`;
  }
  if (object.kind === 'text') {
    return `<text x="${object.x}" y="${object.y + object.height / 2}" fill="${escapeAttr(object.style.stroke)}" font-size="32" font-family="Arial, sans-serif">${escapeText(object.text ?? '文字')}</text>`;
  }
  return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" rx="8" ${style}/>`;
};

const escapeAttr = (value: string) => value.replace(/"/g, '&quot;');
const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const parseViewBox = (viewBox: string): [number, number, number, number] => {
  const parts = viewBox.trim().split(/\s+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? [parts[0], parts[1], parts[2], parts[3]] : [0, 0, CANVAS_WIDTH, CANVAS_HEIGHT];
};
