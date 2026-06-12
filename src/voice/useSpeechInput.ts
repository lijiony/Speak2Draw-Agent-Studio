import { useEffect, useRef, useState } from 'react';
import type { VoiceTranscript } from '../domain/types';
import { resolveEndpointPolicy, type EndpointPolicyMode } from './endpointPolicy';
import { collectRecognitionSnapshot } from './recognitionSnapshot';
import { mapSpeechError, type SpeechErrorInfo } from './speechErrors';
import { createBrowserSpeechRecognition } from './speechProvider';
import { TranscriptAssembler, type TranscriptCandidate } from './transcriptAssembler';

export type SpeechStatus = 'unsupported' | 'idle' | 'starting' | 'listening' | 'error';
export type SpeechDiagnosticPhase =
  | 'idle'
  | 'starting'
  | 'permission_requested'
  | 'permission_granted'
  | 'listening'
  | 'audio_started'
  | 'sound_started'
  | 'speech_started'
  | 'speech_ended'
  | 'interim_result'
  | 'final_result'
  | 'fallback_commit'
  | 'no_speech'
  | 'error'
  | 'stopped'
  | 'restarting';

export interface SpeechDiagnostics {
  policyMode: EndpointPolicyMode;
  phase: SpeechDiagnosticPhase;
  interimText: string | null;
  finalText: string | null;
  reason: string | null;
  updatedAt: number;
}

export interface SpeechInputOptions {
  policyMode?: EndpointPolicyMode;
}

export const useSpeechInput = (onTranscript: (transcript: VoiceTranscript) => void, options: SpeechInputOptions = {}) => {
  const policyMode = options.policyMode ?? 'balanced';
  const endpointPolicy = resolveEndpointPolicy(policyMode);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<SpeechErrorInfo | null>(null);
  const [activity, setActivity] = useState('点击麦克风按钮后开始监听。');
  const [diagnostics, setDiagnostics] = useState<SpeechDiagnostics>(() => ({
    policyMode,
    phase: 'idle',
    interimText: null,
    finalText: null,
    reason: null,
    updatedAt: 0
  }));
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
  const markDiagnostics = (
    phase: SpeechDiagnosticPhase,
    updates: Partial<Omit<SpeechDiagnostics, 'policyMode' | 'phase' | 'updatedAt'>> = {}
  ) => {
    setDiagnostics((current) => ({
      policyMode,
      phase,
      interimText: updates.interimText !== undefined ? updates.interimText : current.interimText,
      finalText: updates.finalText !== undefined ? updates.finalText : current.finalText,
      reason: updates.reason !== undefined ? updates.reason : current.reason,
      updatedAt: performance.now()
    }));
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
        markDiagnostics('no_speech', { reason: '没有收到清晰语音' });
      }
    }, endpointPolicy.noSpeechTimeoutMs);
  };

  const emitTranscript = (candidate: TranscriptCandidate | null) => {
    const transcript = transcriptAssemblerRef.current.commit(candidate, performance.now());
    if (!transcript) return;
    clearRecognitionTimers();
    setError(null);
    setActivity(transcript.isFinal ? `已识别：“${transcript.text}”` : `根据中间识别执行：“${transcript.text}”`);
    markDiagnostics(transcript.isFinal ? 'final_result' : 'fallback_commit', {
      finalText: transcript.isFinal ? transcript.text : null,
      interimText: transcript.isFinal ? null : transcript.text,
      reason: null
    });
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
    }, endpointPolicy.finalResultTimeoutMs);
  };

  const startRecognition = () => {
    try {
      transcriptAssemblerRef.current.reset();
      setSpeechStatus('starting');
      markDiagnostics('starting', { interimText: null, finalText: null, reason: null });
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
      markDiagnostics('error', { reason: '语音识别启动失败' });
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
      markDiagnostics('listening', { interimText: null, finalText: null, reason: null });
      armSilenceTimer();
    };
    recognition.onaudiostart = () => {
      setActivity('麦克风已接入，正在等待声音。');
      markDiagnostics('audio_started');
      armSilenceTimer();
    };
    recognition.onsoundstart = () => {
      setActivity('检测到声音，正在判断是否是语音。');
      markDiagnostics('sound_started');
      clearInterimCommitTimer();
      armSilenceTimer();
    };
    recognition.onspeechstart = () => {
      setActivity('检测到语音，正在识别文字。');
      markDiagnostics('speech_started');
      clearSilenceTimer();
      clearInterimCommitTimer();
      armResultTimer();
    };
    recognition.onspeechend = () => {
      setActivity('检测到停顿，正在等你是否还有补充。');
      markDiagnostics('speech_ended');
      if (transcriptAssemblerRef.current.getFallbackCandidate()) {
        armInterimCommitTimer(endpointPolicy.speechEndGraceMs);
      }
      armResultTimer();
    };
    recognition.onnomatch = () => {
      setError(mapSpeechError('nomatch'));
      setActivity('听到了声音，但没有识别出可执行文字。');
      markDiagnostics('error', { reason: '没有匹配到语音文字' });
      armSilenceTimer();
    };
    recognition.onresult = (event) => {
      const snapshot = collectRecognitionSnapshot(event.results, performance.now());
      if (!snapshot) return;

      if (!snapshot.isFinal) {
        const interim = transcriptAssemblerRef.current.recordInterim(snapshot.text, snapshot.confidence, snapshot.receivedAt);
        setActivity(`正在识别：“${interim?.text ?? snapshot.text}”（继续说，我会等你停顿后执行）`);
        markDiagnostics('interim_result', { interimText: interim?.text ?? snapshot.text, reason: null });
        armInterimCommitTimer(endpointPolicy.interimStabilityMs);
        return;
      }

      emitTranscript(transcriptAssemblerRef.current.createFinal(snapshot.text, snapshot.confidence, snapshot.receivedAt));
    };
    recognition.onerror = (event) => {
      setError(mapSpeechError(event));
      setActivity('语音识别返回错误，请查看处理建议。');
      markDiagnostics('error', { reason: event.error });
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
        markDiagnostics('restarting');
        clearRestartTimer();
        restartTimerRef.current = window.setTimeout(() => {
          if (listeningRequestedRef.current) startRecognition();
        }, endpointPolicy.restartDelayMs);
      } else if (statusRef.current === 'listening' || statusRef.current === 'starting') {
        setSpeechStatus('idle');
        setActivity('监听已结束。');
        markDiagnostics('idle');
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
  }, [onTranscript, endpointPolicy.finalResultTimeoutMs, endpointPolicy.interimStabilityMs, endpointPolicy.noSpeechTimeoutMs, endpointPolicy.restartDelayMs, endpointPolicy.speechEndGraceMs, policyMode]);

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
      markDiagnostics('permission_requested', { interimText: null, finalText: null, reason: null });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setActivity('麦克风权限已通过，正在启动语音识别。');
      setError(null);
      markDiagnostics('permission_granted');
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
      markDiagnostics('error', { reason: '麦克风权限或语音识别启动失败' });
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
    markDiagnostics('stopped');
  };

  return { status, error, activity, diagnostics, start, stop };
};

const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const isInvalidStateError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'InvalidStateError'
    : Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'InvalidStateError');
