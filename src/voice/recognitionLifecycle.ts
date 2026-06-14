export type RecognitionLifecycleStatus = 'unsupported' | 'idle' | 'starting' | 'listening' | 'error';

export type RecognitionEndAction = 'commit_fallback_and_restart' | 'restart' | 'idle' | 'clear';

export interface RecognitionEndState {
  listeningRequested: boolean;
  status: RecognitionLifecycleStatus;
  hasPendingFallback: boolean;
}

export const resolveRecognitionEndAction = ({
  listeningRequested,
  status,
  hasPendingFallback
}: RecognitionEndState): RecognitionEndAction => {
  if (listeningRequested && status !== 'error') {
    return hasPendingFallback ? 'commit_fallback_and_restart' : 'restart';
  }

  if (status === 'listening' || status === 'starting') return 'idle';

  return 'clear';
};
