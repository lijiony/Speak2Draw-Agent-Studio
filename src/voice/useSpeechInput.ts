import { useEffect, useRef, useState } from 'react';
import type { VoiceTranscript } from '../domain/types';
import { DEFAULT_ENDPOINT_POLICY } from './endpointPolicy';
import { mapSpeechError, type SpeechErrorInfo } from './speechErrors';
import { createBrowserSpeechRecognition } from './speechProvider';
import { TranscriptAssembler, type TranscriptCandidate } from './transcriptAssembler';

export type SpeechStatus = 'unsupported' | 'idle' | 'starting' | 'listening' | 'error';

export const useSpeechInput = (onTranscript: (transcript: VoiceTranscript) => void) => {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<SpeechErrorInfo | null>(null);
  const [activity, setActivity] = useState('点击麦克风按钮后开始监听。');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptAssemblerRef = useRef(new TranscriptAssembler());
  const statusRef = useRef<SpeechStatus>('idle');
  const listeningRequestedRef = useRef(false);
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
      if (statusRef.current === 'listening' && !transcriptAssemblerRef.current.hasCommitted()) {
        setError(mapSpeechError('no-speech'));
        setActivity('还没有收到清晰语音，请检查输入设备或靠近麦克风。');
      }
    }, DEFAULT_ENDPOINT_POLICY.noSpeechTimeoutMs);
  };

  const emitTranscript = (candidate: TranscriptCandidate | null) => {
    const transcript = transcriptAssemblerRef.current.commit(candidate, performance.now());
    if (!transcript) return;
    clearRecognitionTimers();
    setError(null);
    setActivity(transcript.isFinal ? `已识别：“${transcript.text}”` : `根据中间识别执行：“${transcript.text}”`);
    onTranscript(transcript);
  };

  const armInterimCommitTimer = (delayMs: number) => {
    clearInterimCommitTimer();
    interimCommitTimerRef.current = window.setTimeout(() => {
      const interim = transcriptAssemblerRef.current.getFallbackCandidate();
      if (statusRef.current === 'listening' && interim && !transcriptAssemblerRef.current.hasCommitted()) {
        emitTranscript(interim);
        try {
          recognitionRef.current?.stop();
        } catch {
          // The recognizer may have already ended after producing the interim text.
        }
      }
    }, delayMs);
  };

  const armResultTimer = () => {
    clearResultTimer();
    resultTimerRef.current = window.setTimeout(() => {
      if (statusRef.current !== 'listening' || transcriptAssemblerRef.current.hasCommitted()) return;
      const interim = transcriptAssemblerRef.current.getFallbackCandidate();
      if (interim) {
        emitTranscript(interim);
      } else {
        setError(mapSpeechError('no-transcript'));
        setActivity('检测到语音，但浏览器没有返回识别文字，正在重新监听。');
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        // Stop is best-effort; onend will decide whether to restart.
      }
    }, DEFAULT_ENDPOINT_POLICY.finalResultTimeoutMs);
  };

  const startRecognition = () => {
    try {
      transcriptAssemblerRef.current.reset();
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
    const recognition = createBrowserSpeechRecognition();
    if (!recognition) {
      setSpeechStatus('unsupported');
      setError(mapSpeechError('unsupported'));
      setActivity('当前浏览器不支持语音识别。');
      return;
    }

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
      clearInterimCommitTimer();
      armSilenceTimer();
    };
    recognition.onspeechstart = () => {
      setActivity('检测到语音，正在识别文字。');
      clearSilenceTimer();
      clearInterimCommitTimer();
      armResultTimer();
    };
    recognition.onspeechend = () => {
      setActivity('检测到停顿，正在等你是否还有补充。');
      if (transcriptAssemblerRef.current.getFallbackCandidate()) {
        armInterimCommitTimer(DEFAULT_ENDPOINT_POLICY.speechEndGraceMs);
      }
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
          transcriptAssemblerRef.current.recordInterim(alternative.transcript, alternative.confidence, performance.now());
          setActivity(`正在识别：“${alternative.transcript.trim()}”（继续说，我会等你停顿后执行）`);
          armInterimCommitTimer(DEFAULT_ENDPOINT_POLICY.interimStabilityMs);
          continue;
        }
        emitTranscript(transcriptAssemblerRef.current.createFinal(alternative.transcript, alternative.confidence, performance.now()));
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
        }, DEFAULT_ENDPOINT_POLICY.restartDelayMs);
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
