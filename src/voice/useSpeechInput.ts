import { useEffect, useRef, useState } from 'react';
import type { VoiceTranscript } from '../domain/types';
import { resolveEndpointPolicy, type EndpointPolicyMode } from './endpointPolicy';
import { resolveRecognitionEndAction } from './recognitionLifecycle';
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
  | 'restarting'
  | 'processing'
  | 'speaking';

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
  suspended?: boolean;
  shouldIgnoreTranscript?: (transcript: VoiceTranscript) => boolean;
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
  const startTimeoutRef = useRef<number | null>(null);
  const permissionTimerRef = useRef<number | null>(null);
  const startRequestIdRef = useRef(0);
  const utteranceCounterRef = useRef(1);
  const currentUtteranceRef = useRef<{ id: string; startedAt: number } | null>(null);
  const suspendedRef = useRef(Boolean(options.suspended));
  const shouldIgnoreTranscriptRef = useRef(options.shouldIgnoreTranscript);
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

  const clearStartTimeout = () => {
    if (startTimeoutRef.current !== null) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  };

  const clearPermissionTimer = () => {
    if (permissionTimerRef.current !== null) {
      window.clearTimeout(permissionTimerRef.current);
      permissionTimerRef.current = null;
    }
  };

  const clearRecognitionTimers = () => {
    clearSilenceTimer();
    clearInterimCommitTimer();
    clearResultTimer();
  };

  const cancelStartRequest = () => {
    startRequestIdRef.current += 1;
    clearPermissionTimer();
    clearStartTimeout();
  };

  useEffect(() => {
    setDiagnostics((current) => ({
      ...current,
      policyMode
    }));
  }, [policyMode]);

  useEffect(() => {
    shouldIgnoreTranscriptRef.current = options.shouldIgnoreTranscript;
  }, [options.shouldIgnoreTranscript]);

  const armStartTimeout = () => {
    clearStartTimeout();
    startTimeoutRef.current = window.setTimeout(() => {
      if (statusRef.current !== 'starting') return;
      listeningRequestedRef.current = false;
      clearRecognitionTimers();
      setSpeechStatus('error');
      setError(mapSpeechError('speech-start-timeout'));
      setActivity('麦克风权限已通过，但语音识别没有进入监听状态。请重试。');
      markDiagnostics('error', { reason: '语音识别启动超时' });
      try {
        recognitionRef.current?.stop();
      } catch {
        // Some browsers throw when stopping a recognizer that never fully started.
      }
    }, SPEECH_START_TIMEOUT_MS);
  };

  const armPermissionTimeout = (requestId: number) => {
    clearPermissionTimer();
    permissionTimerRef.current = window.setTimeout(() => {
      if (requestId !== startRequestIdRef.current || statusRef.current !== 'starting') return;
      listeningRequestedRef.current = false;
      setSpeechStatus('error');
      setError(mapSpeechError('speech-start-timeout'));
      setActivity('麦克风权限请求没有及时返回，请检查浏览器权限提示后重试。');
      markDiagnostics('error', { reason: '麦克风权限请求超时' });
    }, MICROPHONE_PERMISSION_TIMEOUT_MS);
  };

  const isCurrentStartRequest = (requestId: number) =>
    requestId === startRequestIdRef.current && listeningRequestedRef.current && statusRef.current === 'starting';

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
    const committedAt = performance.now();
    const utterance = currentUtteranceRef.current;
    const transcript = transcriptAssemblerRef.current.commit(candidate, committedAt, {
      source: candidate?.isFinal ? 'final' : 'interim-fallback',
      utteranceId: utterance?.id,
      startedAt: utterance?.startedAt,
      stabilityMs: candidate ? Math.max(0, Math.round(committedAt - candidate.receivedAt)) : undefined
    });
    if (!transcript) return;
    clearRecognitionTimers();
    if (shouldIgnoreTranscriptRef.current?.(transcript)) {
      setActivity('已忽略系统朗读或过期语音回声。');
      markDiagnostics('speaking', { reason: '已忽略系统朗读回声' });
      return;
    }
    setError(null);
    setActivity(transcript.isFinal ? `已识别：“${transcript.text}”` : `根据中间识别执行：“${transcript.text}”`);
    markDiagnostics(transcript.isFinal ? 'final_result' : 'fallback_commit', {
      finalText: transcript.isFinal ? transcript.text : null,
      interimText: transcript.isFinal ? null : transcript.text,
      reason: null
    });
    onTranscript(transcript);
  };

  const emitFallbackTranscript = () => {
    const interim = transcriptAssemblerRef.current.getFallbackCandidate();
    if (!interim || transcriptAssemblerRef.current.hasCommitted()) return false;
    emitTranscript(interim);
    return true;
  };

  const armInterimCommitTimer = (delayMs: number) => {
    clearInterimCommitTimer();
    interimCommitTimerRef.current = window.setTimeout(() => {
      if (statusRef.current === 'listening' && emitFallbackTranscript()) {
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
      if (!emitFallbackTranscript()) {
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
      currentUtteranceRef.current = {
        id: `utt-${Date.now()}-${utteranceCounterRef.current++}`,
        startedAt: performance.now()
      };
      setSpeechStatus('starting');
      markDiagnostics('starting', { interimText: null, finalText: null, reason: null });
      armStartTimeout();
      recognitionRef.current?.start();
    } catch (startError) {
      clearStartTimeout();
      if (isInvalidStateError(startError)) {
        setSpeechStatus('listening');
        setActivity('语音识别已经在运行，请直接说出绘图指令。');
        return;
      }
      listeningRequestedRef.current = false;
      cancelStartRequest();
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
      clearStartTimeout();
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
      clearStartTimeout();
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
      clearStartTimeout();
      if (suspendedRef.current) {
        clearRecognitionTimers();
        setSpeechStatus('idle');
        setActivity('系统正在语音反馈，暂缓监听。');
        markDiagnostics('speaking', { reason: '系统语音反馈中' });
        return;
      }

      const endAction = resolveRecognitionEndAction({
        listeningRequested: listeningRequestedRef.current,
        status: statusRef.current,
        hasPendingFallback: Boolean(transcriptAssemblerRef.current.getFallbackCandidate()) && !transcriptAssemblerRef.current.hasCommitted()
      });

      if (endAction === 'commit_fallback_and_restart' || endAction === 'restart') {
        if (endAction === 'commit_fallback_and_restart') {
          emitFallbackTranscript();
        } else {
          clearRecognitionTimers();
          setActivity('本轮监听已结束，正在继续等待下一条指令。');
          markDiagnostics('restarting');
        }
        clearRestartTimer();
        restartTimerRef.current = window.setTimeout(() => {
          if (listeningRequestedRef.current) startRecognition();
        }, endpointPolicy.restartDelayMs);
      } else if (endAction === 'idle') {
        clearRecognitionTimers();
        setSpeechStatus('idle');
        setActivity('监听已结束。');
        markDiagnostics('idle');
      } else {
        clearRecognitionTimers();
      }
    };
    recognitionRef.current = recognition;

    return () => {
      try {
        clearRecognitionTimers();
        clearRestartTimer();
        clearStartTimeout();
        clearPermissionTimer();
        recognition.stop();
      } catch {
        // The recognizer can already be stopped during React cleanup.
      }
    };
  }, [onTranscript, endpointPolicy.finalResultTimeoutMs, endpointPolicy.interimStabilityMs, endpointPolicy.noSpeechTimeoutMs, endpointPolicy.restartDelayMs, endpointPolicy.speechEndGraceMs, policyMode]);

  useEffect(() => {
    suspendedRef.current = Boolean(options.suspended);
    if (options.suspended) {
      clearRecognitionTimers();
      clearRestartTimer();
      try {
        recognitionRef.current?.stop();
      } catch {
        // The recognizer may already be stopped when speech feedback starts.
      }
      if (statusRef.current === 'starting' || statusRef.current === 'listening') {
        setSpeechStatus('idle');
      }
      setActivity('系统正在语音反馈，稍后自动恢复监听。');
      markDiagnostics('speaking', { reason: '系统语音反馈中' });
      return;
    }

    if (listeningRequestedRef.current && statusRef.current === 'idle') {
      setActivity('语音反馈结束，正在恢复监听。');
      markDiagnostics('restarting', { reason: null });
      startRecognition();
    }
  }, [options.suspended]);

  const start = async () => {
    if (statusRef.current === 'starting' || statusRef.current === 'listening') return;
    if (suspendedRef.current) {
      listeningRequestedRef.current = true;
      setActivity('系统正在语音反馈，结束后会自动开始监听。');
      markDiagnostics('speaking', { reason: '系统语音反馈中' });
      return;
    }

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
      const requestId = startRequestIdRef.current + 1;
      startRequestIdRef.current = requestId;
      listeningRequestedRef.current = true;
      setSpeechStatus('starting');
      setError(null);
      setActivity('正在请求麦克风权限。');
      markDiagnostics('permission_requested', { interimText: null, finalText: null, reason: null });
      armPermissionTimeout(requestId);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      clearPermissionTimer();
      if (!isCurrentStartRequest(requestId)) return;
      setActivity('麦克风权限已通过，正在启动语音识别。');
      setError(null);
      markDiagnostics('permission_granted');
      startRecognition();
    } catch (startError) {
      clearPermissionTimer();
      if (isInvalidStateError(startError)) {
        setError(null);
        setSpeechStatus('listening');
        setActivity('语音识别已经在运行，请直接说出绘图指令。');
        return;
      }
      listeningRequestedRef.current = false;
      cancelStartRequest();
      setSpeechStatus('error');
      setError(mapSpeechError(startError));
      setActivity('语音识别启动失败，请查看处理建议。');
      markDiagnostics('error', { reason: '麦克风权限或语音识别启动失败' });
    }
  };

  const stop = () => {
    try {
      listeningRequestedRef.current = false;
      cancelStartRequest();
      clearRecognitionTimers();
      clearRestartTimer();
      clearStartTimeout();
      clearPermissionTimer();
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

const SPEECH_START_TIMEOUT_MS = 4500;
const MICROPHONE_PERMISSION_TIMEOUT_MS = 9000;
const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const isInvalidStateError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'InvalidStateError'
    : Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'InvalidStateError');
