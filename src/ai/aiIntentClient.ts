import type { DrawingIntent, SceneState, VoiceTranscript } from '../domain/types';
import type { AiIntentResponsePayload } from './aiIntentContract';
import { normalizeAiIntent, toAiIntentRequestPayload } from './aiIntentContract';

type PlanLike = {
  needsClarification?: boolean;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const shouldUseAiIntentFallback = (intent: DrawingIntent, plan: PlanLike, transcript: VoiceTranscript) => {
  if (transcript.confidence > 0 && transcript.confidence < 0.55) return false;
  return intent.type === 'unknown' || intent.type === 'clarify' || Boolean(plan.needsClarification);
};

export const resolveAiIntent = async (
  transcript: VoiceTranscript,
  scene: SceneState,
  localReason?: string,
  fetcher: FetchLike = fetch
): Promise<AiIntentResponsePayload> => {
  try {
    const response = await fetcher('/api/ai/intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(toAiIntentRequestPayload(transcript.text, scene, localReason))
    });

    if (!response.ok) {
      return {
        ok: false,
        provider: 'deepseek',
        reason: `AI 指令解析服务返回 ${response.status}`
      };
    }

    const payload = (await response.json()) as AiIntentResponsePayload;
    if (!payload.ok) {
      return {
        ok: false,
        provider: payload.provider,
        reason: sanitizeReason(payload.reason)
      };
    }

    const intent = normalizeAiIntent(payload.intent, transcript.text);
    if (!intent) {
      return {
        ok: false,
        provider: 'deepseek',
        reason: 'AI 返回的绘图意图未通过安全校验。'
      };
    }

    return {
      ok: true,
      provider: 'deepseek',
      model: payload.model,
      intent
    };
  } catch {
    return {
      ok: false,
      provider: 'deepseek',
      reason: 'AI 指令解析暂时不可用，已回退到本地规则。'
    };
  }
};

const sanitizeReason = (reason: string) => reason.trim().slice(0, 120) || 'AI 指令解析暂时不可用。';
