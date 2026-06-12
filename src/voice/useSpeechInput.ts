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
  const listeningRequestedRef = useRef(false);
  const utteranceCommittedRef = useRef(false);
  const lastInterimRef = useRef<{ text: string; confidence: number; receivedAt: number } | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const interimCommitTimerRef = useRef<number | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
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

  const clearInterimCommitTimer = () => {
    if (interimCommitTimerRef.current !== null) {
      window.clearTimeout(interimCommitTimerRef.current);
      interimCommitTimerRef.current = null;
    }
  };

  const clearResultTimer = () => {
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
  };

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const clearRecognitionTimers = () => {
    clearSilenceTimer();
    clearInterimCommitTimer();
    clearResultTimer();
  };

  const armSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      if (statusRef.current === 'listening' && !utteranceCommittedRef.current) {
        setError(mapSpeechError('no-speech'));
        setActivity('还没有收到清晰语音，请检查输入设备或靠近麦克风。');
      }
    }, 12000);
  };

  const emitTranscript = (text: string, confidence: number, isFinal: boolean) => {
    const cleanText = text.trim();
    if (!cleanText || utteranceCommittedRef.current) return;
    utteranceCommittedRef.current = true;
    clearRecognitionTimers();
    setError(null);
    setActivity(isFinal ? `已识别：“${cleanText}”` : `根据中间识别执行：“${cleanText}”`);
    onTranscript({
      text: cleanText,
      confidence: confidence || 0.85,
      receivedAt: performance.now(),
      isFinal
    });
  };

  const armInterimCommitTimer = () => {
    clearInterimCommitTimer();
    interimCommitTimerRef.current = window.setTimeout(() => {
      const interim = lastInterimRef.current;
      if (statusRef.current === 'listening' && interim && !utteranceCommittedRef.current) {
        emitTranscript(interim.text, interim.confidence, false);
        try {
          recognitionRef.current?.stop();
        } catch {
          // The recognizer may have already ended after producing the interim text.
        }
      }
    }, 1800);
  };

  const armResultTimer = () => {
    clearResultTimer();
    resultTimerRef.current = window.setTimeout(() => {
      if (statusRef.current !== 'listening' || utteranceCommittedRef.current) return;
      const interim = lastInterimRef.current;
      if (interim) {
        emitTranscript(interim.text, interim.confidence, false);
      } else {
        setError(mapSpeechError('no-transcript'));
        setActivity('检测到语音，但浏览器没有返回识别文字，正在重新监听。');
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        // Stop is best-effort; onend will decide whether to restart.
      }
    }, 8000);
  };

  const startRecognition = () => {
    try {
      utteranceCommittedRef.current = false;
      lastInterimRef.current = null;
      setSpeechStatus('starting');
      recognitionRef.current?.start();
    } catch (startError) {
      if (isInvalidStateError(startError)) {
        setSpeechStatus('listening');
        setActivity('语音识别已经在运行，请直接说出绘图指令。');
        return;
      }
      listeningRequestedRef.current = false;
      setSpeechStatus('error');
      setError(mapSpeechError(startError));
      setActivity('语音识别启动失败，请查看处理建议。');
    }
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
    recognition.continuous = false;
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
      armResultTimer();
    };
    recognition.onspeechend = () => {
      setActivity('语音已结束，正在等待识别结果。');
      armResultTimer();
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
          lastInterimRef.current = {
            text: alternative.transcript,
            confidence: alternative.confidence || 0.85,
            receivedAt: performance.now()
          };
          setActivity(`正在识别：“${alternative.transcript.trim()}”`);
          armInterimCommitTimer();
          continue;
        }
        emitTranscript(alternative.transcript, alternative.confidence || 0.9, true);
      }
    };
    recognition.onerror = (event) => {
      setError(mapSpeechError(event));
      setActivity('语音识别返回错误，请查看处理建议。');
      clearRecognitionTimers();
      if (event.error === 'no-speech' || event.error === 'nomatch') {
        setSpeechStatus(listeningRequestedRef.current ? 'listening' : 'idle');
      } else {
        listeningRequestedRef.current = false;
        setSpeechStatus('error');
      }
    };
    recognition.onend = () => {
      clearRecognitionTimers();
      if (listeningRequestedRef.current && statusRef.current !== 'error') {
        setActivity('本轮监听已结束，正在继续等待下一条指令。');
        clearRestartTimer();
        restartTimerRef.current = window.setTimeout(() => {
          if (listeningRequestedRef.current) startRecognition();
        }, 300);
      } else if (statusRef.current === 'listening' || statusRef.current === 'starting') {
        setSpeechStatus('idle');
        setActivity('监听已结束。');
      }
    };
    recognitionRef.current = recognition;

    return () => {
      try {
        clearRecognitionTimers();
        clearRestartTimer();
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
      listeningRequestedRef.current = true;
      setSpeechStatus('starting');
      setError(null);
      setActivity('正在请求麦克风权限。');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setActivity('麦克风权限已通过，正在启动语音识别。');
      setError(null);
      startRecognition();
    } catch (startError) {
      if (isInvalidStateError(startError)) {
        setError(null);
        setSpeechStatus('listening');
        setActivity('语音识别已经在运行，请直接说出绘图指令。');
        return;
      }
      listeningRequestedRef.current = false;
      setSpeechStatus('error');
      setError(mapSpeechError(startError));
      setActivity('语音识别启动失败，请查看处理建议。');
    }
  };

  const stop = () => {
    try {
      listeningRequestedRef.current = false;
      clearRecognitionTimers();
      clearRestartTimer();
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
