import { useEffect, useRef, useState } from 'react';
import type { VoiceTranscript } from '../domain/types';
import { mapSpeechError, type SpeechErrorInfo } from './speechErrors';

export type SpeechStatus = 'unsupported' | 'idle' | 'listening' | 'error';

export const useSpeechInput = (onTranscript: (transcript: VoiceTranscript) => void) => {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<SpeechErrorInfo | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus('unsupported');
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
      setStatus('error');
    };
    recognition.onend = () => {
      setStatus((current) => (current === 'listening' ? 'idle' : current));
    };
    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, [onTranscript]);

  const start = async () => {
    if (!window.isSecureContext && !isLocalhost()) {
      setStatus('error');
      setError(mapSpeechError('insecure-context'));
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError(mapSpeechError('unsupported'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.start();
      setError(null);
      setStatus('listening');
    } catch (startError) {
      setStatus('error');
      setError(mapSpeechError(startError));
    }
  };

  const stop = () => {
    recognitionRef.current?.stop();
    setStatus('idle');
  };

  return { status, error, start, stop };
};

const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
