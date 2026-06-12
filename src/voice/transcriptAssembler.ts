import type { VoiceTranscript } from '../domain/types';

export interface TranscriptCandidate {
  text: string;
  confidence: number;
  receivedAt: number;
  isFinal: boolean;
}

export class TranscriptAssembler {
  private latestInterim: TranscriptCandidate | null = null;
  private committed = false;

  reset() {
    this.latestInterim = null;
    this.committed = false;
  }

  recordInterim(text: string, confidence: number, receivedAt: number) {
    const candidate = createTranscriptCandidate(text, confidence, receivedAt, false);
    if (!candidate) return null;
    this.latestInterim = candidate;
    return candidate;
  }

  createFinal(text: string, confidence: number, receivedAt: number) {
    return createTranscriptCandidate(text, confidence, receivedAt, true);
  }

  getFallbackCandidate() {
    return this.latestInterim;
  }

  hasCommitted() {
    return this.committed;
  }

  commit(candidate: TranscriptCandidate | null, committedAt: number): VoiceTranscript | null {
    if (!candidate || this.committed) return null;
    this.committed = true;
    this.latestInterim = null;
    return {
      text: candidate.text,
      confidence: candidate.confidence,
      receivedAt: committedAt,
      isFinal: candidate.isFinal
    };
  }
}

export const createTranscriptCandidate = (
  text: string,
  confidence: number,
  receivedAt: number,
  isFinal: boolean
): TranscriptCandidate | null => {
  const cleanText = text.trim();
  if (!cleanText) return null;
  return {
    text: cleanText,
    confidence: normalizeConfidence(confidence, isFinal),
    receivedAt,
    isFinal
  };
};

const normalizeConfidence = (confidence: number, isFinal: boolean) => {
  if (Number.isFinite(confidence) && confidence > 0) return confidence;
  return isFinal ? 0.9 : 0.85;
};
