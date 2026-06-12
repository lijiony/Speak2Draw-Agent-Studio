import { useEffect, useRef, useState } from 'react';
import type { VoiceTranscript } from '../domain/types';

export type SpeechStatus = 'unsupported' | 'idle' | 'listening' | 'error';

export const useSpeechInput = (onTranscript: (transcript: VoiceTranscript) => void) => {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus('unsupported');
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
      setError(event.error);
      setStatus('error');
    };
    recognition.onend = () => {
      setStatus((current) => (current === 'listening' ? 'idle' : current));
    };
    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, [onTranscript]);

  const start = () => {
    try {
      recognitionRef.current?.start();
      setError('');
      setStatus('listening');
    } catch {
      setStatus('error');
      setError('语音识别启动失败，请检查浏览器权限。');
    }
  };

  const stop = () => {
    recognitionRef.current?.stop();
    setStatus('idle');
  };

  return { status, error, start, stop };
};
