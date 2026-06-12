import { useEffect, useRef, useState } from 'react';
import type { VoiceTranscript } from '../domain/types';
import { mapSpeechError, type SpeechErrorInfo } from './speechErrors';

export type SpeechStatus = 'unsupported' | 'idle' | 'starting' | 'listening' | 'error';

export const useSpeechInput = (onTranscript: (transcript: VoiceTranscript) => void) => {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<SpeechErrorInfo | null>(null);
  const [activity, setActivity] = useState('点击麦克风按钮后开始监听。');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const statusRef = useRef<SpeechStatus>('idle');
  const silenceTimerRef = useRef<number | null>(null);
  const setSpeechStatus = (nextStatus: SpeechStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const armSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      if (statusRef.current === 'listening') {
        setError(mapSpeechError('no-speech'));
        setActivity('还没有收到清晰语音，请检查输入设备或靠近麦克风。');
      }
    }, 12000);
  };

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechStatus('unsupported');
      setError(mapSpeechError('unsupported'));
      setActivity('当前浏览器不支持语音识别。');
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setSpeechStatus('listening');
      setActivity('语音识别已启动，请说出绘图指令。');
      armSilenceTimer();
    };
    recognition.onaudiostart = () => {
      setActivity('麦克风已接入，正在等待声音。');
      armSilenceTimer();
    };
    recognition.onsoundstart = () => {
      setActivity('检测到声音，正在判断是否是语音。');
      armSilenceTimer();
    };
    recognition.onspeechstart = () => {
      setActivity('检测到语音，正在识别文字。');
      clearSilenceTimer();
    };
    recognition.onspeechend = () => {
      setActivity('语音已结束，正在等待识别结果。');
      armSilenceTimer();
    };
    recognition.onnomatch = () => {
      setError(mapSpeechError('nomatch'));
      setActivity('听到了声音，但没有识别出可执行文字。');
      armSilenceTimer();
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        if (!result.isFinal) {
          setActivity(`正在识别：“${alternative.transcript.trim()}”`);
          continue;
        }
        clearSilenceTimer();
        setError(null);
        setActivity(`已识别：“${alternative.transcript.trim()}”`);
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
      setActivity('语音识别返回错误，请查看处理建议。');
      clearSilenceTimer();
      if (event.error === 'no-speech' || event.error === 'nomatch') {
        setSpeechStatus('idle');
      } else {
        setSpeechStatus('error');
      }
    };
    recognition.onend = () => {
      clearSilenceTimer();
      if (statusRef.current === 'listening') {
        setSpeechStatus('idle');
        setActivity('监听已结束，请重新点击麦克风按钮继续。');
      }
    };
    recognitionRef.current = recognition;

    return () => {
      try {
        clearSilenceTimer();
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
      setActivity('正在请求麦克风权限。');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setActivity('麦克风权限已通过，正在启动语音识别。');
      recognitionRef.current?.start();
      setError(null);
    } catch (startError) {
      if (isInvalidStateError(startError)) {
        setError(null);
        setSpeechStatus('listening');
        setActivity('语音识别已经在运行，请直接说出绘图指令。');
        return;
      }
      setSpeechStatus('error');
      setError(mapSpeechError(startError));
      setActivity('语音识别启动失败，请查看处理建议。');
    }
  };

  const stop = () => {
    try {
      clearSilenceTimer();
      recognitionRef.current?.stop();
    } catch {
      // Stop can be called while the recognizer is already idle.
    }
    setSpeechStatus('idle');
    setActivity('监听已停止。');
  };

  return { status, error, activity, start, stop };
};

const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const isInvalidStateError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'InvalidStateError'
    : Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'InvalidStateError');
