import type { VoiceTranscript } from '../domain/types';

export const normalizeTranscriptText = (text: string) =>
  text
    .trim()
    .replace(/[，。！？、,.!?]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

export const isConfirmationAcceptText = (text: string) => /^(确认|是|对|执行|继续|可以|好的|没错|确定)$/.test(normalizeTranscriptText(text));

export const isConfirmationCancelText = (text: string) => /^(取消|不要|不用|算了|停止|别执行|不执行|否|不是)$/.test(normalizeTranscriptText(text));

export const isClarificationCancelText = (text: string) =>
  /(取消补充|取消澄清|不用了|算了|重新开始|先不说这个|跳过)/.test(normalizeTranscriptText(text));

export const looksLikeStandaloneCommand = (text: string) =>
  /(画|添加|创建|绘制|生成|写|选择|选中|删除|删掉|改成|换成|移动|撤销|重做|清空|导出|打开|关闭|画布|当前|帮助|设置|状态)/.test(
    normalizeTranscriptText(text)
  );

export const isRiskyTranscriptSource = (transcript: VoiceTranscript) =>
  transcript.source === 'interim-fallback' || !transcript.isFinal || (transcript.confidence > 0 && transcript.confidence < 0.75);

export const isLikelyEcho = (heardText: string, spokenText: string | null) => {
  if (!spokenText) return false;
  const heard = normalizeTranscriptText(heardText);
  const spoken = normalizeTranscriptText(spokenText);
  if (!heard || !spoken) return false;
  if (heard === spoken) return true;
  if (heard.length < 4 || isConfirmationAcceptText(heard) || isConfirmationCancelText(heard)) return false;
  const ratio = lengthRatio(heard, spoken);
  if ((spoken.includes(heard) || heard.includes(spoken)) && ratio >= 0.48) return true;
  return ratio >= 0.58 && overlapRatio(heard, spoken) >= 0.76;
};

const lengthRatio = (left: string, right: string) => Math.min(left.length, right.length) / Math.max(left.length, right.length);

const overlapRatio = (left: string, right: string) => {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  let shared = 0;
  for (const char of shorter) {
    if (longer.includes(char)) shared += 1;
  }
  return shared / Math.max(1, shorter.length);
};
