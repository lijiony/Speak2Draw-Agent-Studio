import type { DrawingIntent, ObjectSelector, ShapeKind, VoiceTranscript } from './types';
import { includesAny, normalizeVoiceText } from './voiceText';

const COLORS: Record<string, string> = {
  红: '#ef4444',
  红色: '#ef4444',
  蓝: '#2563eb',
  蓝色: '#2563eb',
  绿: '#16a34a',
  绿色: '#16a34a',
  黄: '#facc15',
  黄色: '#facc15',
  黑: '#111827',
  黑色: '#111827',
  白: '#ffffff',
  白色: '#ffffff',
  紫: '#7c3aed',
  紫色: '#7c3aed',
  橙: '#f97316',
  橙色: '#f97316',
  灰: '#6b7280',
  灰色: '#6b7280',
  粉: '#ec4899',
  粉色: '#ec4899'
};

const SHAPES: Array<[string, ShapeKind]> = [
  ['三角形', 'triangle'],
  ['矩形', 'rectangle'],
  ['长方形', 'rectangle'],
  ['方块', 'rectangle'],
  ['正方形', 'rectangle'],
  ['圆形', 'circle'],
  ['圆', 'circle'],
  ['椭圆', 'ellipse'],
  ['线条', 'line'],
  ['直线', 'line'],
  ['线', 'line'],
  ['文字', 'text'],
  ['文本', 'text']
];

export const parseIntent = (transcript: VoiceTranscript): DrawingIntent => {
  const rawText = transcript.text.trim();
  const text = normalize(rawText);

  if (!text) return clarify(rawText, '没有识别到有效语音内容。');
  if (transcript.confidence > 0 && transcript.confidence < 0.55) {
    return clarify(rawText, '语音置信度较低，请再说一遍。');
  }

  return parseNormalizedIntent(rawText, text, true);
};

const parseNormalizedIntent = (rawText: string, text: string, allowSequence: boolean): DrawingIntent => {
  if (/(撤销|取消上一步|退回|撤回)/.test(text)) return { type: 'undo', rawText };
  if (/(重做|恢复上一步|再做一次)/.test(text)) return { type: 'redo', rawText };
  if (/(清空|清除画布|全部删除|重新开始)/.test(text)) return { type: 'clear_canvas', rawText };
  if (/(导出|保存图片|下载图片|保存作品)/.test(text)) return { type: 'export_canvas', rawText };

  if (allowSequence) {
    const sequence = detectSequenceIntent(rawText, text);
    if (sequence) return sequence;
  }

  if (/(删除|删掉|移除|去掉|擦掉)/.test(text)) {
    return { type: 'delete_object', rawText, selector: detectTargetSelector(text, true) };
  }

  if (/(选择|选中|选一下|找到|定位到)/.test(text)) {
    const shape = detectShape(text);
    const color = detectColor(text);
    const name = detectObjectName(text);
    return {
      type: 'select_object',
      rawText,
      selector: text.includes('最后') || text.includes('刚才')
        ? { mode: 'last' }
        : shape || color
          ? { mode: 'by_shape_color', shape, color }
          : name
            ? { mode: 'by_name', name }
            : { mode: 'selected' }
    };
  }

  const layer = detectLayerDirection(text);
  if (layer) return { type: 'reorder_object', rawText, selector: detectTargetSelector(text, true), layer };

  const resize = detectResize(text);
  if (resize) return { type: 'resize_object', rawText, selector: detectTargetSelector(text, true), scale: resize };

  const direction = detectDirection(text);
  if (/(移动|挪|放到|移到|向左|向右|向上|向下|往左|往右|往上|往下|中间|左上|右上|左下|右下)/.test(text) && direction) {
    return { type: 'move_object', rawText, selector: detectTargetSelector(text, true), direction };
  }

  if (/(改成|换成|变成|变为|涂成|填充|颜色|描边|线条加粗|加粗|细一点)/.test(text)) {
    const color = detectColor(text);
    const strokeWidth = text.includes('加粗') ? 8 : text.includes('细一点') ? 2 : undefined;
    return {
      type: 'update_style',
      rawText,
      color,
      strokeColor: text.includes('描边') ? color : undefined,
      strokeWidth,
      selector: detectTargetSelector(text, false)
    };
  }

  const complex = detectComplexScene(text, rawText);
  if (complex) return complex;

  if (/(画|添加|创建|绘制|生成|来一个|写)/.test(text)) {
    const shape = detectShape(text) ?? (text.includes('写') ? 'text' : undefined);
    if (!shape) return clarify(rawText, '听到了创建指令，但没有识别出要画的图形。');
    return {
      type: 'create_shape',
      rawText,
      shape,
      color: detectColor(text),
      position: detectPosition(text),
      text: shape === 'text' ? extractText(rawText) : undefined
    };
  }

  return { type: 'unknown', rawText, reason: '暂不支持这条指令。' };
};

export const normalize = normalizeVoiceText;

export const detectColor = (text: string) => {
  const key = Object.keys(COLORS).find((color) => text.includes(color));
  return key ? COLORS[key] : undefined;
};

export const detectShape = (text: string) => SHAPES.find(([label]) => text.includes(label))?.[1];

const detectObjectName = (text: string) => {
  if (includesAny(text, ['房子', '房屋', '小屋', '屋子'])) return '房子';
  if (text.includes('太阳')) return '太阳';
  if (text.includes('树')) return '树';
  if (text.includes('机器人')) return '机器人';
  return undefined;
};

const detectTargetSelector = (text: string, allowShapeColor: boolean): ObjectSelector => {
  const name = detectObjectName(text);
  if (name) return { mode: 'by_name', name };
  if (!allowShapeColor) return { mode: 'selected' };

  const shape = detectShape(text);
  const color = detectColor(text);
  return shape || color ? { mode: 'by_shape_color', shape, color } : { mode: 'selected' };
};

const detectSequenceIntent = (rawText: string, text: string): DrawingIntent | null => {
  const parts = splitSequenceText(text);
  if (parts.length < 2) return null;

  const intents = parts.map((part) => parseNormalizedIntent(part, part, false));
  if (intents.some((intent) => intent.type === 'unknown' || intent.type === 'clarify')) return null;

  return {
    type: 'sequence',
    rawText,
    intents
  };
};

const splitSequenceText = (text: string) =>
  text
    .replace(/(然后|接着|随后|并且|再把|再将|再给|再让|再)/g, '|')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

const detectComplexScene = (text: string, rawText: string): DrawingIntent | null => {
  if (/(房子|太阳|树|机器人)/.test(text)) return { type: 'create_complex_scene', rawText };
  if (/(和|还有|同时|一起|加上)/.test(text) && /(画|添加|创建|绘制|生成|来一个)/.test(text)) {
    return { type: 'create_complex_scene', rawText };
  }
  return null;
};

const detectPosition = (text: string) => {
  const direction = detectDirection(text);
  if (direction === 'center') return { x: 410, y: 250 };
  if (direction === 'top-left') return { x: 72, y: 72 };
  if (direction === 'top-right') return { x: 740, y: 72 };
  if (direction === 'bottom-left') return { x: 72, y: 440 };
  if (direction === 'bottom-right') return { x: 740, y: 440 };
  return undefined;
};

const detectDirection = (text: string): DrawingIntent['direction'] => {
  if (text.includes('左上')) return 'top-left';
  if (text.includes('右上')) return 'top-right';
  if (text.includes('左下')) return 'bottom-left';
  if (text.includes('右下')) return 'bottom-right';
  if (text.includes('中间') || text.includes('居中') || text.includes('中央')) return 'center';
  if (text.includes('向左') || text.includes('往左') || text.includes('左移') || text.includes('左边')) return 'left';
  if (text.includes('向右') || text.includes('往右') || text.includes('右移') || text.includes('右边')) return 'right';
  if (text.includes('向上') || text.includes('往上') || text.includes('上移') || text.includes('上面')) return 'up';
  if (text.includes('向下') || text.includes('往下') || text.includes('下移') || text.includes('下面')) return 'down';
  return undefined;
};

const detectResize = (text: string) => {
  if (/(放大|变大|大一点|大一些)/.test(text)) return 1.2;
  if (/(缩小|变小|小一点|小一些)/.test(text)) return 0.8;
  return undefined;
};

const detectLayerDirection = (text: string): DrawingIntent['layer'] => {
  if (/(置顶|顶层|最上层|最前面|放到最前|放到前面|移到最前|移到前面)/.test(text)) return 'front';
  if (/(置底|底层|最下层|最后面|放到最后|放到后面|移到最后|移到后面)/.test(text)) return 'back';
  if (/(前移一层|上移一层|往前一层|向前一层)/.test(text)) return 'forward';
  if (/(后移一层|下移一层|往后一层|向后一层)/.test(text)) return 'backward';
  return undefined;
};

const extractText = (rawText: string) => {
  const match = rawText.match(/(?:写|文字|文本)(.+)$/);
  const content = match?.[1]?.trim().replace(/^(文字|文本|内容是|为)/, '');
  return content || '文字';
};

const clarify = (rawText: string, reason: string): DrawingIntent => ({
  type: 'clarify',
  rawText,
  reason
});
