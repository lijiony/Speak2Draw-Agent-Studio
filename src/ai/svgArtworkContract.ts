import type { AiIntentRequestPayload } from './aiIntentContract';

export const SVG_ARTWORK_SCHEMA_VERSION = 'svg-artwork-1.0';

export interface SvgArtworkPartManifest {
  id: string;
  partName: string;
  role?: string;
  editable?: boolean;
}

export interface SvgArtworkPayload {
  schemaVersion: typeof SVG_ARTWORK_SCHEMA_VERSION;
  name: string;
  viewBox: string;
  svg: string;
  parts: SvgArtworkPartManifest[];
  qualityNotes?: string;
}

type SvgArtworkElementPayload = {
  tag: string;
  id?: string;
  partName?: string;
  role?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  children?: SvgArtworkElementPayload[];
};

export interface AiSvgArtworkSuccessPayload {
  ok: true;
  provider: 'deepseek';
  model: string;
  artwork: SvgArtworkPayload;
  schemaVersion: string;
  rawIntentSummary?: string;
}

export interface AiSvgArtworkFailurePayload {
  ok: false;
  provider: 'deepseek' | 'local';
  reason: string;
}

export type AiSvgArtworkResponsePayload = AiSvgArtworkSuccessPayload | AiSvgArtworkFailurePayload;

export const buildDeepSeekSvgArtworkMessages = (payload: AiIntentRequestPayload) => [
  {
    role: 'system',
    content: buildSvgArtworkSystemPrompt(payload)
  },
  {
    role: 'user',
    content: toSvgArtworkPrompt(payload)
  }
] as const;

export const parseDeepSeekSvgArtworkContent = (content: string): SvgArtworkPayload | null => {
  const parsed = parseJsonObject(content);
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== SVG_ARTWORK_SCHEMA_VERSION) return null;
  if (typeof parsed.name !== 'string') return null;
  const viewBox = typeof parsed.viewBox === 'string' ? parsed.viewBox : '0 0 960 600';
  const svg = typeof parsed.svg === 'string' ? parsed.svg : svgFromElements(viewBox, parsed.elements);
  if (!svg) return null;

  const derivedParts = derivePartsFromElements(parsed.elements);
  const rawParts = Array.isArray(parsed.parts) ? [...parsed.parts, ...derivedParts] : derivedParts;
  const parts = rawParts
    .slice(0, 40)
    .map((part) => {
      if (!isRecord(part) || typeof part.id !== 'string' || typeof part.partName !== 'string') return null;
      const id = sanitizeId(part.id);
      const partName = normalizePartName(part.partName).slice(0, 24);
      if (!id || !partName) return null;
      const normalized: SvgArtworkPartManifest = {
        id,
        partName,
        ...(typeof part.role === 'string' ? { role: part.role.trim().slice(0, 24) } : {}),
        editable: part.editable !== false
      };
      return normalized;
    })
    .filter((part): part is SvgArtworkPartManifest => Boolean(part))
    .filter((part, index, all) => all.findIndex((item) => item.id === part.id) === index);

  if (!parts.length) return null;

  return {
    schemaVersion: SVG_ARTWORK_SCHEMA_VERSION,
    name: parsed.name.trim().slice(0, 32) || 'AI SVG 插画',
    viewBox: viewBox.trim().slice(0, 48),
    svg: svg.slice(0, 100_000),
    parts,
    ...(typeof parsed.qualityNotes === 'string' ? { qualityNotes: parsed.qualityNotes.trim().slice(0, 160) } : {})
  };
};

export const summarizeDeepSeekSvgArtworkContent = (content: string) => {
  const artwork = parseDeepSeekSvgArtworkContent(content);
  if (!artwork) return undefined;
  return `svg_artwork:${artwork.name}, parts ${artwork.parts.length}`;
};

const parseJsonObject = (content: string): unknown => {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const sanitizeId = (value: string) => {
  const id = value.trim().slice(0, 48);
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ? id : '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const toSvgArtworkPrompt = (payload: AiIntentRequestPayload) => {
  const assetSummary = payload.scene.assets
    .slice(0, 3)
    .map((asset) => `${asset.groupName}(${asset.parts.slice(0, 6).map((part) => part.partName || part.name).join('/')})`)
    .join('；');
  const englishHint = svgArtworkEnglishHint(payload.transcript);
  const selected = payload.scene.selectedName ? ` 当前选中：${payload.scene.selectedName}。` : '';
  const scene = assetSummary ? ` 当前画布：${assetSummary}。` : '';
  return `json: ${englishHint ? `${englishHint}. Chinese part names.` : svgArtworkSubject(payload.transcript)}，10个元素以内。${selected}${scene}`;
};

const buildSvgArtworkSystemPrompt = (payload: AiIntentRequestPayload) => {
  const subject = svgArtworkSubject(payload.transcript);
  const englishHint = svgArtworkEnglishHint(payload.transcript);
  const target = englishHint || subject;
  return `Return json only. Very short. Create SVG element list for geometric ${target} sticker art. Format {"name":"${escapeJsonExample(subject)}","elements":[{"tag":"circle","id":"head","partName":"头","attrs":{"cx":480,"cy":260,"r":80,"fill":"#f59e0b"}}],"parts":[{"id":"head","partName":"头"}],"qualityNotes":""}. partName must be Chinese.`;
};

const svgArtworkSubject = (text: string) =>
  text
    .replace(/[。！？!?.，,]/g, ' ')
    .replace(/^\s*(请|帮我|给我)?\s*(画|生成|绘制|做|创建)\s*/g, '')
    .replace(/^(一个|一只|一条|一幅|一张)\s*/g, '')
    .trim()
    .slice(0, 24) || '作品';

const escapeJsonExample = (value: string) => value.replace(/\\/g, '').replace(/"/g, '').slice(0, 24) || '作品';

const svgArtworkEnglishHint = (text: string) => {
  const entries: Array<[RegExp, string]> = [
    [/猫.*帽|帽.*猫/, 'cat with hat'],
    [/狮子|lion/i, 'lion'],
    [/猫|cat/i, 'cat'],
    [/狗|dog/i, 'dog'],
    [/房子|房屋|house/i, 'house'],
    [/太阳.*房|房.*太阳/, 'house under sun'],
    [/太阳|sun/i, 'sun'],
    [/小船|帆船|船|boat|ship/i, 'sailboat'],
    [/花瓶|vase/i, 'vase with flowers'],
    [/花|flower/i, 'flower'],
    [/树|tree/i, 'tree'],
    [/车|汽车|car/i, 'car']
  ];
  return entries.find(([pattern]) => pattern.test(text))?.[1];
};

const PART_NAME_MAP: Record<string, string> = {
  head: '头',
  face: '脸',
  mane: '鬃毛',
  hair: '鬃毛',
  body: '身体',
  tail: '尾巴',
  hat: '帽子',
  ear: '耳朵',
  ears: '耳朵',
  leftear: '左耳',
  rightear: '右耳',
  eye: '眼睛',
  eyes: '眼睛',
  lefteye: '左眼',
  righteye: '右眼',
  nose: '鼻子',
  mouth: '嘴巴',
  leg: '腿',
  legs: '腿',
  window: '窗户',
  door: '门',
  roof: '屋顶',
  wall: '墙体',
  sun: '太阳',
  sail: '船帆',
  boat: '船身',
  flower: '花朵',
  vase: '花瓶'
};

const normalizePartName = (value: string) => {
  const trimmed = value.trim();
  const key = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  return PART_NAME_MAP[key] ?? trimmed;
};

const ALLOWED_ELEMENT_TAGS = new Set(['g', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'text']);
const ALLOWED_ELEMENT_ATTRIBUTES = new Set([
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline'
]);

const svgFromElements = (viewBox: unknown, rawElements: unknown) => {
  if (typeof viewBox !== 'string' || !Array.isArray(rawElements)) return null;
  const children = rawElements.slice(0, 28).map((element) => serializeSvgArtworkElement(element, 0)).filter(Boolean).join('');
  if (!children) return null;
  return `<svg viewBox="${escapeAttribute(viewBox.trim().slice(0, 48))}">${children}</svg>`;
};

const serializeSvgArtworkElement = (rawElement: unknown, depth: number): string => {
  if (!isRecord(rawElement) || typeof rawElement.tag !== 'string' || depth > 2) return '';
  const tag = rawElement.tag.trim().toLowerCase();
  if (!ALLOWED_ELEMENT_TAGS.has(tag)) return '';

  const attrs: Record<string, unknown> = isRecord(rawElement.attrs) ? { ...rawElement.attrs } : {};
  const id = typeof rawElement.id === 'string' ? sanitizeId(rawElement.id) : '';
  if (id) attrs.id = id;
  if (typeof rawElement.partName === 'string') attrs['data-part-name'] = normalizePartName(rawElement.partName).slice(0, 24);
  if (typeof rawElement.role === 'string') attrs['data-role'] = rawElement.role.trim().slice(0, 24);

  const attributeText = Object.entries(attrs)
    .map(([name, value]) => serializeAttribute(name, value))
    .filter(Boolean)
    .join('');
  const children = Array.isArray(rawElement.children)
    ? rawElement.children.slice(0, 12).map((child) => serializeSvgArtworkElement(child, depth + 1)).filter(Boolean).join('')
    : '';
  const text = tag === 'text' && typeof rawElement.text === 'string' ? escapeText(rawElement.text.trim().slice(0, 40)) : '';
  return `<${tag}${attributeText}>${children}${text}</${tag}>`;
};

const serializeAttribute = (rawName: string, rawValue: unknown) => {
  const name = rawName.trim().toLowerCase();
  if (name === 'id') {
    const id = typeof rawValue === 'string' ? sanitizeId(rawValue) : '';
    return id ? ` id="${id}"` : '';
  }
  if (name === 'data-part-name' || name === 'data-role') {
    const value = name === 'data-part-name' && typeof rawValue === 'string' ? normalizePartName(rawValue) : rawValue;
    return typeof value === 'string' && value.trim() ? ` ${name}="${escapeAttribute(value.trim().slice(0, 24))}"` : '';
  }
  if (!ALLOWED_ELEMENT_ATTRIBUTES.has(name)) return '';
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') return '';
  const value = String(rawValue).trim().slice(0, 360);
  if (!value || /[<>]|javascript:|data:|blob:|file:|https?:|url\(/i.test(value)) return '';
  return ` ${name}="${escapeAttribute(value)}"`;
};

const derivePartsFromElements = (rawElements: unknown): SvgArtworkPartManifest[] => {
  if (!Array.isArray(rawElements)) return [];
  const parts: SvgArtworkPartManifest[] = [];
  const visit = (rawElement: unknown) => {
    if (!isRecord(rawElement)) return;
    const attrs = isRecord(rawElement.attrs) ? rawElement.attrs : {};
    const id =
      typeof rawElement.id === 'string'
        ? sanitizeId(rawElement.id)
        : typeof attrs.id === 'string'
          ? sanitizeId(attrs.id)
          : '';
    const partName =
      typeof rawElement.partName === 'string'
        ? normalizePartName(rawElement.partName).slice(0, 24)
        : typeof attrs['data-part-name'] === 'string'
          ? normalizePartName(attrs['data-part-name']).slice(0, 24)
          : '';
    if (id && partName && !parts.some((part) => part.id === id)) {
      parts.push({
        id,
        partName,
        ...(typeof rawElement.role === 'string' ? { role: rawElement.role.trim().slice(0, 24) } : {}),
        editable: true
      });
    }
    if (Array.isArray(rawElement.children)) rawElement.children.forEach(visit);
  };
  rawElements.forEach(visit);
  return parts;
};

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
