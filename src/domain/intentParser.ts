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

const PART_NAMES = ['房子窗户', '窗户', '窗', '房子门', '门', '屋顶', '墙体', '帽檐', '帽子', '眼睛', '左眼', '右眼', '耳朵', '左耳', '右耳', '鼻子', '脸', '头部', '身体'];

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
  if (/(帮助|怎么用|使用说明|可用指令|有哪些指令|我能说什么|能说什么)/.test(text)) return { type: 'help', rawText };
  if (/(画布里有什么|画布有什么|现在有什么|当前画布|描述画布|有哪些图形|图形列表|画面里有什么)/.test(text)) {
    return { type: 'describe_scene', rawText };
  }
  if (/(当前选中|选中的是什么|我选中了什么|现在选中|选择的是谁|选中哪个)/.test(text)) {
    return { type: 'describe_selection', rawText };
  }

  if (/(撤销|取消上一步|退回|撤回)/.test(text)) return { type: 'undo', rawText };
  if (/(重做|恢复上一步|再做一次)/.test(text)) return { type: 'redo', rawText };
  if (/(清空|清除画布|全部删除|重新开始)/.test(text)) return { type: 'clear_canvas', rawText };
  if (/(导出|保存图片|下载图片|保存作品)/.test(text)) return { type: 'export_canvas', rawText };

  if (allowSequence) {
    const sequence = detectSequenceIntent(rawText, text);
    if (sequence) return sequence;
  }

  if (/(删除|删掉|删去|移除|去掉|擦掉)/.test(text)) {
    return { type: 'delete_object', rawText, selector: detectTargetSelector(text, true) };
  }

  if (/(选择|选中|选一下|找到|定位到)/.test(text)) {
    return {
      type: 'select_object',
      rawText,
      selector: text.includes('最后') || text.includes('刚才')
        ? { mode: 'last' }
        : detectTargetSelector(text, true)
    };
  }

  const layer = detectLayerDirection(text);
  if (layer) return { type: 'reorder_object', rawText, selector: detectTargetSelector(text, true), layer };

  const resize = detectResize(text);
  if (resize) return { type: 'resize_object', rawText, selector: detectTargetSelector(text, true), scale: resize };

  const direction = detectDirection(text);
  if (/(移动|挪|放到|移到|左移|右移|上移|下移|向左|向右|向上|向下|往左|往右|往上|往下|中间|左上|右上|左下|右下)/.test(text) && direction) {
    return { type: 'move_object', rawText, selector: detectTargetSelector(text, true), direction };
  }

  const rename = detectRenameIntent(text, rawText);
  if (rename) return rename;

  const textUpdate = detectTextUpdateIntent(text, rawText);
  if (textUpdate) return textUpdate;

  const duplicate = detectDuplicateIntent(text, rawText);
  if (duplicate) return duplicate;

  const ungroup = detectUngroupIntent(text, rawText);
  if (ungroup) return ungroup;

  const group = detectGroupIntent(text, rawText);
  if (group) return group;

  const alignment = detectAlignment(text);
  if (alignment) {
    return { type: 'align_objects', rawText, selector: detectMultiTargetSelector(text), alignment };
  }

  const axis = detectDistributionAxis(text);
  if (axis) {
    return { type: 'distribute_objects', rawText, selector: detectMultiTargetSelector(text), axis };
  }

  if (/(改成|换成|变成|变为|涂成|填充|颜色|描边|线条加粗|加粗|细一点)/.test(text) && !(detectColor(text) || /(描边|线条加粗|加粗|细一点)/.test(text))) {
    return clarify(rawText, '没有识别出要修改的颜色或样式，请说“把它改成黄色”或“线条加粗”。');
  }

  if ((detectColor(text) || /(描边|线条加粗|加粗|细一点)/.test(text)) && /(改成|换成|变成|变为|涂成|填充|颜色|描边|线条加粗|加粗|细一点)/.test(text)) {
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
      name: shape === 'text' ? undefined : extractCustomName(text),
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
  const partName = detectPartObjectName(text);
  if (partName) return partName;
  if (includesAny(text, ['房子', '房屋', '小屋', '屋子'])) return '房子';
  if (text.includes('太阳')) return '太阳';
  if (text.includes('树')) return '树';
  if (text.includes('机器人')) return '机器人';
  const customName = extractTargetName(text) ?? extractCustomName(text);
  if (customName && (detectShape(customName) || detectColor(customName))) return undefined;
  if (customName && !isPronoun(customName)) return customName;
  return undefined;
};

const detectTargetSelector = (text: string, allowShapeColor: boolean): ObjectSelector => {
  const scope = detectTargetScope(text);
  const name = detectObjectName(text);
  if (name) return { mode: 'by_name', name, ...(scope ? { scope } : {}) };
  if (!allowShapeColor) return { mode: 'selected', ...(scope ? { scope } : {}) };

  const shape = detectShape(text);
  const color = detectColor(text);
  return shape || color ? { mode: 'by_shape_color', shape, color, ...(scope ? { scope } : {}) } : { mode: 'selected', ...(scope ? { scope } : {}) };
};

const detectMultiTargetSelector = (text: string): ObjectSelector => {
  if (/(所有|全部|全都|整个画布|所有图形|全部图形|全部对象|所有对象)/.test(text)) return { mode: 'all' };

  const names = extractTargetNames(text);
  if (names.length > 1) return { mode: 'by_names', names };
  if (names.length === 1) {
    const scope = detectTargetScope(text);
    return { mode: 'by_name', name: names[0], ...(scope ? { scope } : {}) };
  }
  return detectTargetSelector(text, true);
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

const extractCustomName = (text: string) => {
  const match = text.match(/(?:叫|命名为|名字叫|名称叫)([^，。,.、\s]+)/);
  return sanitizeName(match?.[1]);
};

const extractTargetName = (text: string) => {
  const byPrefix = text.match(/(?:选择|选中|选一下|找到|定位到|删除|删掉|删去|移除|去掉|擦掉|放大|缩小|复制|再复制|再来一个|拷贝|克隆)([^，。,.、\s]+)/);
  const byObjectMarker = text.match(/(?:把|将)(.+?)(?:改名|重命名|名字改成|名称改成|名字叫|名称叫|命名为|命名成|叫做|叫成|文字改成|文本改成|内容改成|改成|换成|变成|变为|涂成|填充|颜色|描边|线条加粗|加粗|细一点|复制|再复制|再来一个|拷贝|克隆|移动|挪|放到|移到|左移|右移|上移|下移|放大|变大|缩小|变小|置顶|顶层|最上层|最前面|置底|底层|最下层|最后面|前移|后移|删除|删掉|删去|移除|去掉|擦掉)/);
  return sanitizeName(byPrefix?.[1] ?? byObjectMarker?.[1]);
};

const sanitizeName = (name?: string) => {
  const value = name
    ?.trim()
    .replace(/^(一个|一只|一条|这个|那个|它|他|她)/, '')
    .replace(/(向左|向右|向上|向下|往左|往右|往上|往下|左移|右移|上移|下移|左边|右边|上面|下面|左上|右上|左下|右下|中间|居中|中央)$/, '')
    .replace(/(向|往)$/, '')
    .replace(/(图形|对象)$/, '');
  return value && !isPronoun(value) ? value : undefined;
};

const detectTargetScope = (text: string): ObjectSelector['scope'] | undefined => {
  if (/(整个|整只|整座|整棵|整条|全部|全都|一整|素材组|整组|整体)/.test(text)) return 'group';
  if (hasPartSignal(text)) return 'part';
  return undefined;
};

const detectPartObjectName = (text: string) => {
  const explicit = extractTargetName(text);
  if (explicit && hasPartSignal(explicit)) return explicit;
  return PART_NAMES.find((name) => text.includes(name));
};

const hasPartSignal = (text: string) => PART_NAMES.some((name) => text.includes(name)) || /(局部|部件)/.test(text);

const isPronoun = (value: string) => ['它', '他', '她', '这个', '那个', '选中', '最后', '刚才'].includes(value);

const detectRenameIntent = (text: string, rawText: string): DrawingIntent | null => {
  if (!/(改名|重命名|名字改成|名称改成|命名为|命名成|叫做|叫成)/.test(text)) return null;
  const name = extractRenamedName(text);
  if (!name) return clarify(rawText, '听到了改名指令，但没有识别出新的名称。');
  return {
    type: 'rename_object',
    rawText,
    selector: detectTargetSelector(text, true),
    name
  };
};

const detectTextUpdateIntent = (text: string, rawText: string): DrawingIntent | null => {
  if (!/(文字|文本|内容)/.test(text) || !/(改成|换成|变成|改为|换为)/.test(text)) return null;
  const updatedText = extractUpdatedText(text);
  if (!updatedText) return clarify(rawText, '听到了文字编辑指令，但没有识别出新的文字内容。');
  return {
    type: 'update_text',
    rawText,
    selector: detectTargetSelector(text, false),
    text: updatedText
  };
};

const detectDuplicateIntent = (text: string, rawText: string): DrawingIntent | null => {
  if (!/(复制|再复制|再来一个|拷贝|克隆|复制一份|复制一个)/.test(text)) return null;
  return {
    type: 'duplicate_object',
    rawText,
    selector: detectTargetSelector(text, true)
  };
};

const detectGroupIntent = (text: string, rawText: string): DrawingIntent | null => {
  if (!/(成组|组合|编组|组成一组|合成一组|合并成组)/.test(text)) return null;
  if (/(取消|解除|拆开|拆散|解散)/.test(text)) return null;
  return {
    type: 'group_objects',
    rawText,
    selector: detectMultiTargetSelector(text),
    name: extractCustomName(text)
  };
};

const detectUngroupIntent = (text: string, rawText: string): DrawingIntent | null => {
  if (!/(取消分组|取消成组|解除分组|解除成组|拆开组合|拆散组合|解散组合|解散组|取消.+分组|解除.+分组|拆开.+组合|拆散.+组合|解散.+组合)/.test(text)) return null;
  return {
    type: 'ungroup_objects',
    rawText,
    selector: detectMultiTargetSelector(text)
  };
};

const detectAlignment = (text: string): DrawingIntent['alignment'] => {
  if (!/(对齐|居中)/.test(text)) return undefined;
  if (/(左对齐|左边对齐|靠左对齐)/.test(text)) return 'left';
  if (/(右对齐|右边对齐|靠右对齐)/.test(text)) return 'right';
  if (/(顶端对齐|顶部对齐|上对齐|靠上对齐)/.test(text)) return 'top';
  if (/(底端对齐|底部对齐|下对齐|靠下对齐)/.test(text)) return 'bottom';
  if (/(垂直居中|纵向居中)/.test(text)) return 'center-y';
  if (/(水平居中|横向居中|居中对齐|中心对齐)/.test(text)) return 'center-x';
  return undefined;
};

const detectDistributionAxis = (text: string): DrawingIntent['axis'] => {
  if (!/(分布|均匀|等距)/.test(text)) return undefined;
  if (/(垂直分布|纵向分布|上下均匀|垂直等距|纵向等距)/.test(text)) return 'vertical';
  if (/(水平分布|横向分布|左右均匀|水平等距|横向等距|均匀分布|等距排列)/.test(text)) return 'horizontal';
  return undefined;
};

const extractTargetNames = (text: string) => {
  const ungroupPhrase = text.match(/(?:取消|解除|拆开|拆散|解散)(.+?)(?:的)?(?:分组|成组|组合)/)?.[1];
  const targetPhrase = ungroupPhrase ?? text.match(
    /(?:把|将)?(.+?)(?:成组|组合|编组|组成一组|合成一组|合并成组|取消分组|取消成组|解除分组|解除成组|拆开组合|拆散组合|解散组合|解散组|左对齐|右对齐|左边对齐|右边对齐|顶端对齐|顶部对齐|底端对齐|底部对齐|上对齐|下对齐|水平居中|垂直居中|居中对齐|中心对齐|水平分布|垂直分布|均匀分布|等距排列)/
  )?.[1];
  if (!targetPhrase) return [];

  const names = targetPhrase
    .split(/和|还有|与|跟|及|、/)
    .map((item) => sanitizeName(item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(names));
};

const extractRenamedName = (text: string) => {
  const match = text.match(/(?:改名为|重命名为|改名成|重命名成|名字改成|名称改成|命名为|命名成|叫做|叫成)([^，。,.、\s]+)/);
  return sanitizeName(match?.[1]);
};

const extractUpdatedText = (text: string) => {
  const match = text.match(/(?:把|将)?(.*?)(?:的)?(?:文字|文本|内容)(?:改成|换成|变成|改为|换为)(.+)$/);
  const value = match?.[2]?.trim();
  return value || undefined;
};

const clarify = (rawText: string, reason: string): DrawingIntent => ({
  type: 'clarify',
  rawText,
  reason
});
