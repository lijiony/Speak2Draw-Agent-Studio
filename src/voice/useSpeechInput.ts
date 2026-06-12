import { useEffect, useRef, useState } from 'react';
import type { VoiceTranscript } from '../domain/types';
import { mapSpeechError, type SpeechErrorInfo } from './speechErrors';

export type SpeechStatus = 'unsupported' | 'idle' | 'starting' | 'listening' | 'error';

export const useSpeechInput = (onTranscript: (transcript: VoiceTranscript) => void) => {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<SpeechErrorInfo | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const statusRef = useRef<SpeechStatus>('idle');
  const setSpeechStatus = (nextStatus: SpeechStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  };

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechStatus('unsupported');
      setError(mapSpeechError('unsupported'));
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result.isFinal) continue;
        const alternative = result[0];
        onTranscript({
          text: alternative.transcript,
          confidence: alternative.confidence || 0.9,
          receivedAt: performance.now(),
          isFinal: true
        });
      }
    };
    recognition.onerror = (event) => {
      setError(mapSpeechError(event));
      setSpeechStatus('error');
    };
    recognition.onend = () => {
      if (statusRef.current === 'listening') {
        setSpeechStatus('idle');
      }
    };
    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // The recognizer can already be stopped during React cleanup.
      }
    };
  }, [onTranscript]);

  const start = async () => {
    if (statusRef.current === 'starting' || statusRef.current === 'listening') return;

    if (!window.isSecureContext && !isLocalhost()) {
      setSpeechStatus('error');
      setError(mapSpeechError('insecure-context'));
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setSpeechStatus('error');
      setError(mapSpeechError('unsupported'));
      return;
    }

    try {
      setSpeechStatus('starting');
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.start();
      setError(null);
      setSpeechStatus('listening');
    } catch (startError) {
      if (isInvalidStateError(startError)) {
        setError(null);
        setSpeechStatus('listening');
        return;
      }
      setSpeechStatus('error');
      setError(mapSpeechError(startError));
    }
  };

  const stop = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Stop can be called while the recognizer is already idle.
    }
    setSpeechStatus('idle');
  };

  return { status, error, start, stop };
};

const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const isInvalidStateError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'InvalidStateError'
    : Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'InvalidStateError');
