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
    content:
      '你是 Speak2Draw 的安全 SVG 插画设计器。只输出 JSON，不要解释，不要 Markdown，不要代码块。' +
      `固定输出格式：{"schemaVersion":"${SVG_ARTWORK_SCHEMA_VERSION}","name":"作品名","viewBox":"0 0 960 600","svg":"<svg ...>...</svg>","parts":[...],"qualityNotes":"..."}。` +
      '目标是生成展示级、好看的、可局部标注的 SVG 插画。构图要清楚，主体要完整，颜色要协调，元素不能挤在一起。' +
      'svg 必须是完整 <svg viewBox="0 0 960 600">，只能使用安全静态 SVG 元素：svg、g、path、circle、ellipse、rect、line、polyline、polygon、text、defs、linearGradient、radialGradient、stop。' +
      '禁止使用 script、foreignObject、style、metadata、image、use、iframe、audio、video、animate、set、animateTransform、animateMotion、filter、mask、clipPath、pattern、symbol、任何外链资源、base64、HTML 或可执行内容。' +
      '禁止任何 onload、onclick、onerror 等 on* 事件属性。禁止 href、xlink:href、src、class、style 属性。禁止 xmlns:xlink。禁止 url(http...)、url(javascript...)、data:、blob:、file:、http://、https://。渐变只能使用本地 url(#id)。' +
      '不要返回 CSS、不要返回嵌入图片、不要返回动画、不要返回滤镜；如果需要阴影或高光，用半透明基础形状表达。' +
      '每个可编辑局部必须在 SVG 元素或 g 上带 id 和 data-part-name，例如 data-part-name="帽子"。parts 数组必须列出这些局部 id、partName、role、editable。' +
      '常见局部包括：脸、眼睛、鼻子、嘴、耳朵、帽子、身体、尾巴、窗户、门、屋顶、墙体、太阳、船帆、船身、花瓶、花朵。' +
      'id 只能使用英文字母、数字、下划线和短横线。颜色使用十六进制。文字内容必须简短。'
  },
  {
    role: 'user',
    content: JSON.stringify(payload)
  }
] as const;

export const parseDeepSeekSvgArtworkContent = (content: string): SvgArtworkPayload | null => {
  const parsed = parseJsonObject(content);
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== SVG_ARTWORK_SCHEMA_VERSION) return null;
  if (typeof parsed.name !== 'string' || typeof parsed.viewBox !== 'string' || typeof parsed.svg !== 'string') return null;
  if (!Array.isArray(parsed.parts) || parsed.parts.length === 0) return null;

  const parts = parsed.parts
    .slice(0, 40)
    .map((part) => {
      if (!isRecord(part) || typeof part.id !== 'string' || typeof part.partName !== 'string') return null;
      const id = sanitizeId(part.id);
      const partName = part.partName.trim().slice(0, 24);
      if (!id || !partName) return null;
      const normalized: SvgArtworkPartManifest = {
        id,
        partName,
        ...(typeof part.role === 'string' ? { role: part.role.trim().slice(0, 24) } : {}),
        editable: part.editable !== false
      };
      return normalized;
    })
    .filter((part): part is SvgArtworkPartManifest => Boolean(part));

  if (!parts.length) return null;

  return {
    schemaVersion: SVG_ARTWORK_SCHEMA_VERSION,
    name: parsed.name.trim().slice(0, 32) || 'AI SVG 插画',
    viewBox: parsed.viewBox.trim().slice(0, 48),
    svg: parsed.svg.slice(0, 100_000),
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
