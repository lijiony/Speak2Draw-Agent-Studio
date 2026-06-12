import { createTranscriptCandidate, type TranscriptCandidate } from './transcriptAssembler';

export const collectRecognitionSnapshot = (
  results: SpeechRecognitionResultList,
  receivedAt: number
): TranscriptCandidate | null => {
  const parts: string[] = [];
  const confidences: number[] = [];
  let isFinal = results.length > 0;

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const alternative = result[0];
    if (!alternative) continue;

    const text = alternative.transcript.trim();
    if (text) parts.push(text);
    if (!result.isFinal) isFinal = false;
    if (Number.isFinite(alternative.confidence) && alternative.confidence > 0) {
      confidences.push(alternative.confidence);
    }
  }

  return createTranscriptCandidate(parts.join(''), averageConfidence(confidences), receivedAt, isFinal);
};

const averageConfidence = (confidences: number[]) => {
  if (!confidences.length) return 0;
  const average = confidences.reduce((total, value) => total + value, 0) / confidences.length;
  return Math.round(average * 1000) / 1000;
};
