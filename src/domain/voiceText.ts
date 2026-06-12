const PUNCTUATION_PATTERN = /[，。！？、,.!?；;：:\s]/g;

const TEXT_COMMAND_PATTERN = /(写|文字|文本|输入|内容)/;

const GENERAL_CORRECTIONS: Array<[RegExp, string]> = [
  [/圆型|圆行|园形|园型/g, '圆形'],
  [/矩型|距形/g, '矩形'],
  [/长方型|长方行/g, '长方形'],
  [/三角型|三角行/g, '三角形'],
  [/椭圆形/g, '椭圆'],
  [/直钱|线段/g, '直线'],
  [/太陽/g, '太阳'],
  [/房屋|小屋|屋子|房间/g, '房子'],
  [/機器人/g, '机器人']
];

export const normalizeVoiceText = (value: string) => {
  const compact = value.trim().replace(PUNCTUATION_PATTERN, '');
  return applyContextCorrections(applyGeneralCorrections(compact));
};

export const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

const applyGeneralCorrections = (text: string) =>
  GENERAL_CORRECTIONS.reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), text);

const applyContextCorrections = (text: string) => {
  if (TEXT_COMMAND_PATTERN.test(text)) return text;

  const soundsLikeHouseInScene =
    text.includes('名字') && (includesAny(text, ['太阳', '树', '机器人', '和', '还有', '一起', '同时', '加上']) || /^画.*名字/.test(text));

  return soundsLikeHouseInScene ? text.replace(/名字/g, '房子') : text;
};
