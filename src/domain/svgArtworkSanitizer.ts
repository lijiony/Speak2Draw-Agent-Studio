import { CANVAS_HEIGHT, CANVAS_WIDTH } from './sceneModel';
import type { SvgArtworkData, SvgArtworkDiagnostics, SvgArtworkPart } from './types';
import type { SvgArtworkPayload } from '../ai/svgArtworkContract';

export interface SvgArtworkSanitizeResult {
  ok: boolean;
  artwork?: SvgArtworkData;
  diagnostics: SvgArtworkDiagnostics;
  reason?: string;
}

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop'
]);

const CONTAINER_ELEMENTS = new Set(['svg', 'g', 'defs', 'lineargradient', 'radialgradient']);
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'style',
  'metadata',
  'image',
  'use',
  'iframe',
  'audio',
  'video',
  'animate',
  'set',
  'animatetransform',
  'animatemotion',
  'feimage',
  'filter',
  'mask',
  'clippath',
  'pattern',
  'symbol'
]);

const ALLOWED_ATTRIBUTES = new Set([
  'id',
  'data-part-name',
  'data-role',
  'd',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
  'font-size',
  'font-family',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'offset',
  'stop-color',
  'stop-opacity'
]);

const URL_ATTRIBUTE_NAMES = new Set(['href', 'xlink:href', 'src']);
const NUMERIC_ATTRIBUTES = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'stroke-width',
  'font-size'
]);
const MAX_SVG_LENGTH = 100_000;
const MAX_ELEMENT_COUNT = 360;
const MAX_PATH_LENGTH = 4_000;
const MAX_POINTS_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 80;
const ARTWORK_CANVAS_WIDTH = 960;
const ARTWORK_CANVAS_HEIGHT = 600;

const CANONICAL_TAG_NAMES: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient'
};

export const sanitizeSvgArtwork = (payload: SvgArtworkPayload, transcript?: string): SvgArtworkSanitizeResult => {
  const warnings: string[] = [];
  const baseDiagnostics = (status: SvgArtworkDiagnostics['sanitizerStatus'], overrides: Partial<SvgArtworkDiagnostics> = {}): SvgArtworkDiagnostics => ({
    generationMode: 'safe-svg-artwork',
    schemaVersion: payload.schemaVersion,
    transcript,
    name: payload.name,
    viewBox: payload.viewBox,
    sanitizerStatus: status,
    sanitizedElementCount: 0,
    droppedElementCount: 0,
    droppedAttributeCount: 0,
    partCount: 0,
    safeMarkupLength: 0,
    qualityNotes: payload.qualityNotes,
    warnings,
    ...overrides
  });

  if (payload.svg.length > MAX_SVG_LENGTH) {
    return {
      ok: false,
      reason: 'SVG 内容过大。',
      diagnostics: baseDiagnostics('rejected', { fallbackReason: 'SVG 内容过大。' })
    };
  }

  if (!isSafeViewBox(payload.viewBox)) {
    return {
      ok: false,
      reason: 'SVG viewBox 不安全。',
      diagnostics: baseDiagnostics('rejected', { fallbackReason: 'SVG viewBox 不安全。' })
    };
  }

  if (containsUnsafeUrl(payload.svg) || /\s(?:href|xlink:href|src)\s*=/i.test(payload.svg)) {
    return {
      ok: false,
      reason: 'SVG 包含外链或不安全 URL。',
      diagnostics: baseDiagnostics('rejected', { fallbackReason: 'SVG 包含外链或不安全 URL。' })
    };
  }

  const parser = createDomParser();
  if (!parser) {
    return {
      ok: false,
      reason: '当前环境不支持 SVG 解析。',
      diagnostics: baseDiagnostics('rejected', { fallbackReason: '当前环境不支持 SVG 解析。' })
    };
  }

  const parsed = parser.parseFromString(payload.svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) {
    return {
      ok: false,
      reason: 'SVG XML 无法解析。',
      diagnostics: baseDiagnostics('rejected', { fallbackReason: 'SVG XML 无法解析。' })
    };
  }

  const sourceSvg = parsed.documentElement;
  if (!sourceSvg || sourceSvg.tagName.toLowerCase() !== 'svg') {
    return {
      ok: false,
      reason: 'AI 未返回完整 SVG。',
      diagnostics: baseDiagnostics('rejected', { fallbackReason: 'AI 未返回完整 SVG。' })
    };
  }

  const safeDoc = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
  const counters = { elements: 0, droppedElements: 0, droppedAttributes: 0 };
  const safeChildren: Element[] = [];
  for (const child of Array.from(sourceSvg.childNodes)) {
    const safeChild = sanitizeNode(child, safeDoc, counters, warnings);
    if (safeChild && safeChild.nodeType === Node.ELEMENT_NODE) safeChildren.push(safeChild as Element);
  }

  if (counters.elements > MAX_ELEMENT_COUNT) {
    return {
      ok: false,
      reason: 'SVG 元素数量过多。',
      diagnostics: baseDiagnostics('rejected', {
        sanitizedElementCount: counters.elements,
        droppedElementCount: counters.droppedElements,
        droppedAttributeCount: counters.droppedAttributes,
        fallbackReason: 'SVG 元素数量过多。'
      })
    };
  }

  const manifestParts = payload.parts.filter((part) => part.editable !== false);
  const availableIds = new Set(safeChildren.flatMap((child) => collectElementIds(child)));
  const safeParts: SvgArtworkPart[] = manifestParts
    .filter((part) => availableIds.has(part.id))
    .map((part) => {
      const target = findElementById(safeChildren, part.id);
      const bounds = target ? estimateElementBounds(target) : undefined;
      return {
        id: part.id,
        partName: part.partName,
        ...(part.role ? { role: part.role } : {}),
        editable: true,
        ...(bounds ? { bounds } : {})
      };
    });

  if (!safeParts.length) {
    return {
      ok: false,
      reason: 'SVG 没有可编辑局部标记。',
      diagnostics: baseDiagnostics('rejected', {
        sanitizedElementCount: counters.elements,
        droppedElementCount: counters.droppedElements,
        droppedAttributeCount: counters.droppedAttributes,
        fallbackReason: 'SVG 没有可编辑局部标记。'
      })
    };
  }

  const safeMarkup = safeChildren.map((child) => serializeElement(child)).join('');
  const diagnostics = baseDiagnostics('accepted', {
    sanitizedElementCount: counters.elements,
    droppedElementCount: counters.droppedElements,
    droppedAttributeCount: counters.droppedAttributes,
    partCount: safeParts.length,
    safeMarkupLength: safeMarkup.length
  });

  return {
    ok: true,
    diagnostics,
    artwork: {
      name: payload.name,
      viewBox: '0 0 960 600',
      safeMarkup,
      parts: safeParts,
      qualityNotes: payload.qualityNotes,
      diagnostics
    }
  };
};

export const removeSvgArtworkPart = (artwork: SvgArtworkData, partIdOrName: string): SvgArtworkData => {
  const parser = createDomParser();
  if (!parser) return artwork;
  const wrapper = `<svg xmlns="http://www.w3.org/2000/svg">${artwork.safeMarkup}</svg>`;
  const doc = parser.parseFromString(wrapper, 'image/svg+xml');
  const targetParts = artwork.parts.filter((part) => part.id === partIdOrName || nameMatches(part.partName, partIdOrName));
  if (!targetParts.length) return artwork;
  for (const part of targetParts) {
    const target = doc.getElementById(part.id);
    target?.parentNode?.removeChild(target);
  }
  const safeMarkup = Array.from(doc.documentElement.childNodes).map((node) => serializeNode(node)).join('');
  const removedIds = new Set(targetParts.map((part) => part.id));
  return {
    ...artwork,
    safeMarkup,
    parts: artwork.parts.filter((part) => !removedIds.has(part.id)),
    diagnostics: {
      ...artwork.diagnostics,
      partCount: artwork.parts.filter((part) => !removedIds.has(part.id)).length,
      safeMarkupLength: safeMarkup.length
    }
  };
};

export const recolorSvgArtworkPart = (artwork: SvgArtworkData, partIdOrName: string, color: string): SvgArtworkData => {
  if (!isSafeColor(color)) return artwork;
  const parser = createDomParser();
  if (!parser) return artwork;
  const wrapper = `<svg xmlns="http://www.w3.org/2000/svg">${artwork.safeMarkup}</svg>`;
  const doc = parser.parseFromString(wrapper, 'image/svg+xml');
  const targetParts = artwork.parts.filter((part) => part.id === partIdOrName || nameMatches(part.partName, partIdOrName));
  for (const part of targetParts) {
    const target = doc.getElementById(part.id);
    if (!target) continue;
    target.setAttribute('fill', color);
    for (const child of Array.from(target.querySelectorAll('*'))) {
      if (child.getAttribute('fill') && child.getAttribute('fill') !== 'none') child.setAttribute('fill', color);
    }
  }
  const safeMarkup = Array.from(doc.documentElement.childNodes).map((node) => serializeNode(node)).join('');
  return {
    ...artwork,
    safeMarkup,
    diagnostics: {
      ...artwork.diagnostics,
      safeMarkupLength: safeMarkup.length
    }
  };
};

const sanitizeNode = (
  node: ChildNode,
  safeDoc: XMLDocument,
  counters: { elements: number; droppedElements: number; droppedAttributes: number },
  warnings: string[]
): Element | Text | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.slice(0, MAX_TEXT_LENGTH) ?? '';
    return text.trim() ? safeDoc.createTextNode(text) : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (FORBIDDEN_ELEMENTS.has(tag) || !ALLOWED_ELEMENTS.has(tag)) {
    counters.droppedElements += 1;
    warnings.push(`已丢弃不安全 SVG 标签：${tag}`);
    return null;
  }
  if (counters.elements >= MAX_ELEMENT_COUNT) {
    counters.droppedElements += 1;
    return null;
  }

  counters.elements += 1;
  const safeElement = safeDoc.createElementNS('http://www.w3.org/2000/svg', CANONICAL_TAG_NAMES[tag] ?? tag);
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (!isSafeAttribute(name, value)) {
      counters.droppedAttributes += 1;
      continue;
    }
    safeElement.setAttribute(name, sanitizeAttributeValue(name, value));
  }

  for (const child of Array.from(element.childNodes)) {
    const safeChild = sanitizeNode(child, safeDoc, counters, warnings);
    if (safeChild) safeElement.appendChild(safeChild);
  }

  if (tag !== 'stop' && !CONTAINER_ELEMENTS.has(tag) && !hasRenderableAttributes(safeElement)) {
    counters.droppedElements += 1;
    return null;
  }

  return safeElement;
};

const isSafeAttribute = (name: string, value: string) => {
  if (!value) return true;
  if (name.startsWith('on')) return false;
  if (URL_ATTRIBUTE_NAMES.has(name)) return false;
  if (name === 'style' || name === 'class') return false;
  if (containsUnsafeUrl(value)) return false;
  if (name === 'id') return /^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value);
  if (name === 'data-part-name' || name === 'data-role') return value.length <= 32 && !/[<>]/.test(value);
  if (name === 'd') return value.length <= MAX_PATH_LENGTH && /^[MmZzLlHhVvCcSsQqTtAa0-9,.\-\s]+$/.test(value);
  if (name === 'points') return value.length <= MAX_POINTS_LENGTH && /^[0-9,.\-\s]+$/.test(value);
  if (name === 'transform') return value.length <= 240 && /^(translate|scale|rotate|matrix|skewX|skewY|\(|\)|,|\.|\-|[0-9]|\s)+$/.test(value);
  if (name === 'fill' || name === 'stroke' || name === 'stop-color') return isSafePaint(value);
  if (name.includes('opacity')) return isFiniteNumber(value, 0, 1);
  if (name === 'font-family') return /^[\w\s"',-]{1,80}$/.test(value);
  if (name === 'font-weight') return /^(normal|bold|[1-9]00)$/.test(value);
  if (name === 'text-anchor') return /^(start|middle|end)$/.test(value);
  if (name === 'dominant-baseline') return /^(auto|middle|central|hanging|text-before-edge|text-after-edge)$/.test(value);
  if (name === 'stroke-linecap') return /^(round|butt|square)$/.test(value);
  if (name === 'stroke-linejoin') return /^(round|miter|bevel)$/.test(value);
  if (name === 'offset') return /^(\d{1,3}%|0?\.\d+|1|0)$/.test(value);
  if (NUMERIC_ATTRIBUTES.has(name)) return isFiniteNumber(value, -4000, 4000);
  if (ALLOWED_ATTRIBUTES.has(name)) return isSafeNumericList(value);
  return false;
};

const sanitizeAttributeValue = (name: string, value: string) => {
  if (name === 'data-part-name' || name === 'data-role') return value.slice(0, 32);
  if (name === 'font-family') return value.slice(0, 80);
  return value.slice(0, name === 'd' ? MAX_PATH_LENGTH : 2_000);
};

const hasRenderableAttributes = (element: Element) =>
  ['d', 'x', 'y', 'cx', 'cy', 'r', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2'].some((attribute) => element.hasAttribute(attribute)) ||
  element.tagName.toLowerCase() === 'text';

const isSafeViewBox = (value: string) => {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return false;
  const [, , width, height] = parts;
  return width > 0 && height > 0 && width <= 2000 && height <= 2000;
};

const isSafePaint = (value: string) =>
  value === 'none' ||
  /^#[0-9a-fA-F]{3}$/.test(value) ||
  /^#[0-9a-fA-F]{6}$/.test(value) ||
  /^url\(#[A-Za-z][A-Za-z0-9_-]{0,47}\)$/.test(value);

const isSafeColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

const isSafeNumericList = (value: string) => /^[0-9,.\-%\s]+$/.test(value);

const isFiniteNumber = (value: string, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
};

const containsUnsafeUrl = (value: string) => {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  return /javascript:|data:|blob:|file:|https?:|url\((?!#[a-z0-9_-]+\))/i.test(normalized);
};

const collectElementIds = (element: Element): string[] => {
  const ids: string[] = [];
  if (element.id) ids.push(element.id);
  for (const child of Array.from(element.children)) ids.push(...collectElementIds(child));
  return ids;
};

const findElementById = (elements: Element[], id: string): Element | undefined => {
  for (const element of elements) {
    if (element.id === id) return element;
    const nested = findElementById(Array.from(element.children), id);
    if (nested) return nested;
  }
  return undefined;
};

const estimateElementBounds = (element: Element): SvgArtworkPart['bounds'] | undefined => {
  const tag = element.tagName.toLowerCase();
  if (tag === 'g' || tag === 'svg') return combineBounds(Array.from(element.children).map(estimateElementBounds).filter(isBounds));
  if (tag === 'rect') {
    const x = numberAttr(element, 'x') ?? 0;
    const y = numberAttr(element, 'y') ?? 0;
    const width = numberAttr(element, 'width') ?? 0;
    const height = numberAttr(element, 'height') ?? 0;
    return validBounds(x, y, width, height);
  }
  if (tag === 'circle') {
    const cx = numberAttr(element, 'cx') ?? 0;
    const cy = numberAttr(element, 'cy') ?? 0;
    const r = numberAttr(element, 'r') ?? 0;
    return validBounds(cx - r, cy - r, r * 2, r * 2);
  }
  if (tag === 'ellipse') {
    const cx = numberAttr(element, 'cx') ?? 0;
    const cy = numberAttr(element, 'cy') ?? 0;
    const rx = numberAttr(element, 'rx') ?? 0;
    const ry = numberAttr(element, 'ry') ?? 0;
    return validBounds(cx - rx, cy - ry, rx * 2, ry * 2);
  }
  if (tag === 'line') {
    const x1 = numberAttr(element, 'x1') ?? 0;
    const y1 = numberAttr(element, 'y1') ?? 0;
    const x2 = numberAttr(element, 'x2') ?? x1;
    const y2 = numberAttr(element, 'y2') ?? y1;
    return validBounds(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) || 4, Math.abs(y2 - y1) || 4);
  }
  if (tag === 'polygon' || tag === 'polyline') return boundsFromNumberPairs(element.getAttribute('points') ?? '');
  if (tag === 'path') return boundsFromNumberPairs(element.getAttribute('d') ?? '');
  if (tag === 'text') {
    const x = numberAttr(element, 'x') ?? 0;
    const y = numberAttr(element, 'y') ?? 0;
    const fontSize = numberAttr(element, 'font-size') ?? 24;
    const textLength = element.textContent?.length ?? 1;
    return validBounds(x, y - fontSize, Math.max(24, textLength * fontSize * 0.62), fontSize * 1.25);
  }
  return undefined;
};

const boundsFromNumberPairs = (value: string): SvgArtworkPart['bounds'] | undefined => {
  const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (numbers.length < 2) return undefined;
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < numbers.length - 1; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
  if (!points.length) return undefined;
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  return validBounds(left, top, right - left, bottom - top);
};

const combineBounds = (bounds: Array<NonNullable<SvgArtworkPart['bounds']>>): SvgArtworkPart['bounds'] | undefined => {
  if (!bounds.length) return undefined;
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return validBounds(left, top, right - left, bottom - top);
};

const numberAttr = (element: Element, name: string) => {
  const value = element.getAttribute(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const validBounds = (x: number, y: number, width: number, height: number): SvgArtworkPart['bounds'] | undefined => {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return {
    x: clamp(x, 0, ARTWORK_CANVAS_WIDTH),
    y: clamp(y, 0, ARTWORK_CANVAS_HEIGHT),
    width: clamp(width, 1, ARTWORK_CANVAS_WIDTH),
    height: clamp(height, 1, ARTWORK_CANVAS_HEIGHT)
  };
};

const isBounds = (value: SvgArtworkPart['bounds'] | undefined): value is NonNullable<SvgArtworkPart['bounds']> => Boolean(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createDomParser = () => {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') return null;
  return new DOMParser();
};

const serializeElement = (element: Element) => new XMLSerializer().serializeToString(element);

const serializeNode = (node: ChildNode) => new XMLSerializer().serializeToString(node);

const nameMatches = (value: string, query: string) =>
  Boolean(value && query && (value.includes(query) || query.includes(value)));

export const createSvgArtworkObjectBounds = () => ({
  x: 96,
  y: 48,
  width: ARTWORK_CANVAS_WIDTH - 192,
  height: ARTWORK_CANVAS_HEIGHT - 96
});
