import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  GaugeCircle,
  HelpCircle,
  Layers3,
  Mic,
  MicOff,
  MoveRight,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  Radio,
  Redo2,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
  WandSparkles,
  X
} from 'lucide-react';
import { resolveAiIntent, resolveAiSvgArtwork, shouldUseAiIntentFallback, type AiRequestOptions } from './ai/aiIntentClient';
import type { AiClarificationContext } from './ai/aiIntentContract';
import { planCommands } from './domain/commandPlanner';
import { executeDrawingCommands } from './domain/drawingExecutor';
import { parseIntent } from './domain/intentParser';
import { createEmptyScene, createSceneObject, findObjects } from './domain/sceneModel';
import { createSvgArtworkObjectBounds, sanitizeSvgArtwork } from './domain/svgArtworkSanitizer';
import type { DrawingCommand, DrawingIntent, ExecutionResult, SceneObject, SceneState, SvgArtworkData, SvgArtworkDiagnostics, VoiceTranscript } from './domain/types';
import { runMicrophoneInputTest, type MicrophoneInputSample, type MicrophoneTestResult } from './voice/microphoneTest';
import type { EndpointPolicyMode } from './voice/endpointPolicy';
import { useSpeechInput, type SpeechDiagnostics } from './voice/useSpeechInput';
import { speak } from './voice/voiceFeedback';
import { VoiceCommandQueue, type VoiceCommandItem, type VoiceCommandQueueSnapshot } from './voice/voiceCommandQueue';
import {
  isClarificationCancelText,
  isConfirmationAcceptText,
  isConfirmationCancelText,
  isLikelyEcho,
  isRiskyTranscriptSource,
  looksLikeStandaloneCommand
} from './voice/voiceSafety';
import {
  loadAppSettings,
  resetAppSettings,
  saveAppSettings,
  toPublicSettingsSnapshot,
  type AppSettings,
  type PublicSettingsSnapshot
} from './settings/appSettings';
import { detectLayoutCommand, workbenchLayoutMessage, type WorkbenchLayout } from './ui/workbenchLayout';

type AiResolutionStatus = {
  state: 'idle' | 'local' | 'checking' | 'used' | 'fallback';
  message: string;
};

const AI_GENERATING_NOTICE = 'AI 正在生成中，请先别继续说；后续语音会排队。';
const AI_GENERATION_MIN_TIMEOUT_MS = 30000;

type ClarificationState = AiClarificationContext & {
  waiting: true;
  createdAt: number;
  expiresAt: number;
};

type HistoryItem = {
  transcript: string;
  message: string;
  source: string;
  ok?: boolean;
  time?: string;
};

type CommandAction = (text: string) => Promise<void>;

type WorkflowEvent = {
  id: number;
  title: string;
  detail: string;
  tone: 'info' | 'ok' | 'warning';
  time: string;
};

type SettingsTab = 'ai' | 'voice' | 'privacy';

type AiConnectionStatus = {
  state: 'idle' | 'testing' | 'ok' | 'failed';
  message: string;
  checkedAt?: string;
};

type VoiceRuntimePhase =
  | 'idle'
  | 'requesting_permission'
  | 'starting'
  | 'listening'
  | 'capturing'
  | 'settling'
  | 'committing'
  | 'processing'
  | 'speaking'
  | 'restarting'
  | 'error';

type VoiceRuntimeSnapshot = {
  phase: VoiceRuntimePhase;
  recentEvent: string;
  queue: VoiceCommandQueueSnapshot;
  processing: boolean;
  speaking: boolean;
  waitingConfirmation: boolean;
  lastError: string | null;
  updatedAt: number;
};

type PendingConfirmationState = {
  commandId: string;
  transcript: VoiceTranscript;
  message: string;
  createdAt: number;
  expiresAt: number;
};

type TestSpeechEvent = {
  text?: string;
  confidence?: number;
  isFinal?: boolean;
  source?: VoiceTranscript['source'];
};

declare global {
  interface Window {
    __speak2drawTest?: {
      submitTranscript: (text: string, confidence?: number) => Promise<void>;
      getScene: () => SceneState;
      getAiStatus: () => AiResolutionStatus;
      getClarification: () => ClarificationState | null;
      getVoiceDiagnostics: () => SpeechDiagnostics;
      getVoiceRuntime: () => VoiceRuntimeSnapshot;
      getCommandQueue: () => VoiceCommandQueueSnapshot;
      emitSpeechEvent: (event: TestSpeechEvent) => Promise<void>;
      getSettings: () => PublicSettingsSnapshot;
      getWorkbenchLayout: () => WorkbenchLayout;
    };
  }
}

export const App = () => {
  const [showLanding, setShowLanding] = useState(() => !isE2eMode() && window.location.hash !== '#workbench');
  const enterWorkbench = useCallback(() => {
    setShowLanding(false);
    if (window.location.hash !== '#workbench') window.history.replaceState(null, '', '#workbench');
  }, []);
  const [scene, setScene] = useState<SceneState>(() => createEmptyScene());
  const sceneRef = useRef(scene);
  const [lastTranscript, setLastTranscript] = useState('等待语音指令');
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const lastResultRef = useRef<ExecutionResult | null>(null);
  const [micTestStatus, setMicTestStatus] = useState<'idle' | 'testing'>('idle');
  const [micTestResult, setMicTestResult] = useState<MicrophoneTestResult | null>(null);
  const [micTestSample, setMicTestSample] = useState<MicrophoneInputSample | null>(null);
  const [micTestLevels, setMicTestLevels] = useState<number[]>([]);
  const [aiStatus, setAiStatus] = useState<AiResolutionStatus>(() => ({
    state: 'idle',
    message: '等待需要 AI 协助的语音指令。'
  }));
  const aiStatusRef = useRef(aiStatus);
  const [clarification, setClarification] = useState<ClarificationState | null>(null);
  const clarificationRef = useRef<ClarificationState | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const voiceDiagnosticsRef = useRef<SpeechDiagnostics | null>(null);
  const commandQueueRef = useRef(new VoiceCommandQueue());
  const processingQueueRef = useRef(false);
  const [commandQueueSnapshot, setCommandQueueSnapshot] = useState<VoiceCommandQueueSnapshot>(() => commandQueueRef.current.snapshot());
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmationState | null>(null);
  const pendingConfirmationRef = useRef<PendingConfirmationState | null>(null);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const voiceSpeakingRef = useRef(false);
  const lastSpokenTextRef = useRef<string | null>(null);
  const lastSpokenAtRef = useRef(0);
  const [voiceRuntime, setVoiceRuntime] = useState<VoiceRuntimeSnapshot>(() => ({
    phase: 'idle',
    recentEvent: '等待语音输入。',
    queue: commandQueueRef.current.snapshot(),
    processing: false,
    speaking: false,
    waitingConfirmation: false,
    lastError: null,
    updatedAt: 0
  }));
  const voiceRuntimeRef = useRef(voiceRuntime);
  const [settings, setSettingsState] = useState<AppSettings>(() => loadAppSettings());
  const settingsRef = useRef(settings);
  const sessionApiKeyRef = useRef('');
  const [sessionKeyConfigured, setSessionKeyConfigured] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('ai');
  const [workbenchLayout, setWorkbenchLayout] = useState<WorkbenchLayout>('focus');
  const workbenchLayoutRef = useRef<WorkbenchLayout>('focus');
  const [aiConnectionStatus, setAiConnectionStatus] = useState<AiConnectionStatus>({
    state: 'idle',
    message: '尚未测试 AI 连接。'
  });
  const [canvasHintsCollapsed, setCanvasHintsCollapsed] = useState(false);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [toastEvent, setToastEvent] = useState<WorkflowEvent | null>(null);
  const workflowEventIdRef = useRef(1);
  const lastWorkflowKeyRef = useRef('');
  const voicePolicyMode = settings.voicePolicyMode;

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    aiStatusRef.current = aiStatus;
  }, [aiStatus]);

  useEffect(() => {
    clarificationRef.current = clarification;
  }, [clarification]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    workbenchLayoutRef.current = workbenchLayout;
  }, [workbenchLayout]);

  const setSettings = useCallback((next: AppSettings | ((current: AppSettings) => AppSettings)) => {
    setSettingsState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      saveAppSettings(resolved);
      settingsRef.current = resolved;
      return resolved;
    });
  }, []);

  const setVoicePolicyMode = useCallback(
    (mode: EndpointPolicyMode) => setSettings((current) => ({ ...current, voicePolicyMode: mode })),
    [setSettings]
  );

  const pushWorkflowEvent = useCallback((title: string, detail: string, tone: WorkflowEvent['tone'] = 'info') => {
    const event: WorkflowEvent = {
      id: workflowEventIdRef.current++,
      title,
      detail,
      tone,
      time: formatClockTime()
    };
    setWorkflowEvents((items) => [event, ...items].slice(0, 12));
    setToastEvent(event);
  }, []);

  const getAiRequestOptions = useCallback(
    (mode: AppSettings['aiGenerationMode'] = 'editable-recipe'): AiRequestOptions => {
      const configuredTimeoutMs = settingsRef.current.aiTimeoutMs;
      return {
        baseUrl: settingsRef.current.aiBaseUrl,
        model: settingsRef.current.aiModel,
        timeoutMs: Math.max(configuredTimeoutMs, AI_GENERATION_MIN_TIMEOUT_MS),
        sessionApiKey: sessionApiKeyRef.current || undefined
      };
    },
    []
  );

  const runAiConnectionTest = useCallback(async () => {
    setAiConnectionStatus({ state: 'testing', message: '正在测试 DeepSeek 连接。' });
    const startedAt = performance.now();
    const result = await resolveAiIntent(
      {
        text: '画一个红色圆形',
        confidence: 0.99,
        receivedAt: performance.now(),
        isFinal: true
      },
      createEmptyScene(),
      'AI 连接测试',
      undefined,
      getAiRequestOptions()
    );
    const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
    const message = result.ok
      ? `AI 连接正常，模型 ${result.model}，耗时 ${elapsed}ms。`
      : `AI 连接失败：${result.reason}`;
    setAiConnectionStatus({
      state: result.ok ? 'ok' : 'failed',
      message,
      checkedAt: formatClockTime()
    });
    pushWorkflowEvent(result.ok ? 'AI 连接测试通过' : 'AI 连接测试失败', message, result.ok ? 'ok' : 'warning');
    return message;
  }, [getAiRequestOptions, pushWorkflowEvent]);

  const refreshCommandQueueSnapshot = useCallback(() => {
    const snapshot = commandQueueRef.current.snapshot();
    setCommandQueueSnapshot(snapshot);
    return snapshot;
  }, []);

  const updateVoiceRuntime = useCallback(
    (updates: Partial<Omit<VoiceRuntimeSnapshot, 'queue' | 'updatedAt' | 'processing' | 'speaking' | 'waitingConfirmation'>> = {}) => {
      const next: VoiceRuntimeSnapshot = {
        ...voiceRuntimeRef.current,
        ...updates,
        queue: commandQueueRef.current.snapshot(),
        processing: processingQueueRef.current,
        speaking: voiceSpeakingRef.current,
        waitingConfirmation: Boolean(pendingConfirmationRef.current),
        updatedAt: performance.now()
      };
      voiceRuntimeRef.current = next;
      setVoiceRuntime(next);
      setCommandQueueSnapshot(next.queue);
      return next;
    },
    []
  );

  const clearPendingConfirmation = useCallback(() => {
    pendingConfirmationRef.current = null;
    setPendingConfirmation(null);
    updateVoiceRuntime();
  }, [updateVoiceRuntime]);

  const speakFeedback = useCallback(
    async (message: string) => {
      lastSpokenTextRef.current = message;
      lastSpokenAtRef.current = performance.now();
      voiceSpeakingRef.current = true;
      setVoiceSpeaking(true);
      updateVoiceRuntime({ phase: 'speaking', recentEvent: message });
      try {
        if (isE2eMode()) {
          await Promise.resolve();
        } else {
          await speak(message);
        }
      } finally {
        voiceSpeakingRef.current = false;
        setVoiceSpeaking(false);
        updateVoiceRuntime({ phase: processingQueueRef.current ? 'processing' : 'restarting', recentEvent: '语音反馈结束，恢复监听。' });
      }
    },
    [updateVoiceRuntime]
  );

  const publishResult = useCallback(
    async (transcript: VoiceTranscript, result: ExecutionResult, source: string, eventTitle?: string) => {
      const resultForDisplay =
        result.commandsExecuted === 0
          ? {
              ...result,
              ...(!result.layoutDiagnostics && lastResultRef.current?.layoutDiagnostics
                ? { layoutDiagnostics: lastResultRef.current.layoutDiagnostics }
                : {}),
              ...(!result.svgArtworkDiagnostics && lastResultRef.current?.svgArtworkDiagnostics
                ? { svgArtworkDiagnostics: lastResultRef.current.svgArtworkDiagnostics }
                : {})
            }
          : result;
      setLastTranscript(transcript.text);
      setScene(result.scene);
      sceneRef.current = result.scene;
      setLastResult(resultForDisplay);
      lastResultRef.current = resultForDisplay;
      setHistory((items) => [
        {
          transcript: transcript.text,
          message: result.message,
          source,
          ok: result.ok,
          time: formatClockTime()
        },
        ...items
      ].slice(0, 8));
      pushWorkflowEvent(eventTitle ?? (result.ok ? '画布已更新' : '需要补充信息'), result.message, result.ok ? 'ok' : 'warning');
      await speakFeedback(result.message);
      if (result.exportSvg) downloadSvg(result.exportSvg);
    },
    [pushWorkflowEvent, speakFeedback]
  );

  const buildUiResult = useCallback((message: string, sceneSnapshot: SceneState, transcript: VoiceTranscript, ok = true): ExecutionResult => ({
    ok,
    message,
    scene: sceneSnapshot,
    commandsExecuted: 0,
    latencyMs: Math.max(0, Math.round(performance.now() - transcript.receivedAt))
  }), []);

  const executeVoiceCommand = useCallback(
    async (item: VoiceCommandItem, options: { skipConfirmation?: boolean } = {}) => {
      const transcript = item.transcript;
      const currentScene = sceneRef.current;
      updateVoiceRuntime({ phase: 'processing', recentEvent: `正在处理：“${transcript.text}”`, lastError: null });

      const pending = pendingConfirmationRef.current;
      if (!options.skipConfirmation && pending) {
        if (performance.now() > pending.expiresAt) {
          clearPendingConfirmation();
          await publishResult(
            transcript,
            buildUiResult('上一条确认已超时，请重新说出要执行的指令。', currentScene, transcript, false),
            '安全确认',
            '确认已超时'
          );
          return;
        }

        if (isConfirmationAcceptText(transcript.text)) {
          clearPendingConfirmation();
          const confirmedItem: VoiceCommandItem = {
            ...item,
            transcript: {
              ...pending.transcript,
              confidence: Math.max(pending.transcript.confidence, 0.99),
              isFinal: true,
              source: 'final',
              receivedAt: transcript.receivedAt
            }
          };
          pushWorkflowEvent('危险操作已确认', pending.message, 'warning');
          await executeVoiceCommand(confirmedItem, { skipConfirmation: true });
          return;
        }

        if (isConfirmationCancelText(transcript.text)) {
          clearPendingConfirmation();
          await publishResult(
            transcript,
            buildUiResult('已取消上一条危险操作，画布没有变化。', currentScene, transcript, true),
            '安全确认',
            '危险操作已取消'
          );
          return;
        }

        if (!looksLikeStandaloneCommand(transcript.text)) {
          await publishResult(
            transcript,
            buildUiResult('请说“确认”执行上一条危险操作，或说“取消”放弃。', currentScene, transcript, false),
            '安全确认',
            '等待确认'
          );
          return;
        }

        clearPendingConfirmation();
        pushWorkflowEvent('已放弃等待确认', '收到新的完整指令，上一条危险操作未执行。', 'info');
      }

      if (isClarificationCancelText(transcript.text)) {
        clarificationRef.current = null;
        setClarification(null);
        await publishResult(
          transcript,
          buildUiResult('已取消上一轮补充问题，可以直接说新的绘图指令。', currentScene, transcript, true),
          '澄清控制',
          '澄清已取消'
        );
        return;
      }

      const settingsCommand = detectSettingsCommand(transcript.text);
      if (settingsCommand) {
        let message = '已更新设置。';
        if (settingsCommand.type === 'open') {
          setSettingsOpen(true);
          setActiveSettingsTab(settingsCommand.tab);
          message = settingsCommand.tab === 'ai' ? '已打开 AI 设置。' : settingsCommand.tab === 'voice' ? '已打开语音设置。' : '已打开设置。';
        }
        if (settingsCommand.type === 'close') {
          setSettingsOpen(false);
          message = '已关闭设置，返回画布。';
        }
        if (settingsCommand.type === 'model') {
          setSettings((current) => ({ ...current, aiModel: settingsCommand.model }));
          setSettingsOpen(true);
          setActiveSettingsTab('ai');
          message = `已将 AI 模型切换为 ${settingsCommand.model}。`;
        }
        if (settingsCommand.type === 'generation-mode') {
          setSettings((current) => ({ ...current, aiGenerationMode: settingsCommand.mode }));
          setSettingsOpen(true);
          setActiveSettingsTab('ai');
          message =
            settingsCommand.mode === 'safe-svg-artwork'
              ? '已切换到安全 SVG 插画模式。'
              : '已切换到可编辑配方模式。';
        }
        if (settingsCommand.type === 'voice-policy') {
          setVoicePolicyMode(settingsCommand.mode);
          setSettingsOpen(true);
          setActiveSettingsTab('voice');
          message = `已将语音模式切换为 ${settingsCommand.mode}。`;
        }
        if (settingsCommand.type === 'test-ai') {
          setSettingsOpen(true);
          setActiveSettingsTab('ai');
          message = await runAiConnectionTest();
        }

        await publishResult(transcript, buildUiResult(message, currentScene, transcript, !message.includes('失败')), '设置', '设置已处理');
        return;
      }

      const layoutCommand = detectLayoutCommand(transcript.text);
      if (layoutCommand) {
        const message = workbenchLayoutMessage(layoutCommand);
        setWorkbenchLayout(layoutCommand);
        await publishResult(transcript, buildUiResult(message, currentScene, transcript), '界面布局', '布局已切换');
        return;
      }

      const panelCommand = detectStatusPanelCommand(transcript.text);
      if (panelCommand) {
        const message = panelCommand === 'open' ? '已打开状态信息。' : '已关闭状态信息。';
        setStatusPanelOpen(panelCommand === 'open');
        await publishResult(transcript, buildUiResult(message, currentScene, transcript), '界面控制', panelCommand === 'open' ? '状态信息已打开' : '状态信息已关闭');
        return;
      }

      let activeClarification = clarificationRef.current;
      if (activeClarification && performance.now() > activeClarification.expiresAt) {
        activeClarification = null;
        clarificationRef.current = null;
        setClarification(null);
        pushWorkflowEvent('澄清已过期', '上一轮补充问题已超时，当前语音会按新指令处理。', 'info');
      }
      const localIntent = parseIntent(transcript);
      if (activeClarification && looksLikeStandaloneCommand(transcript.text) && !shouldUseAiIntentFallback(localIntent, planCommands(localIntent, currentScene), transcript)) {
        activeClarification = null;
        clarificationRef.current = null;
        setClarification(null);
        pushWorkflowEvent('已切换到新指令', '检测到完整新指令，已清除上一轮补充问题。', 'info');
      }

      let plan = planCommands(localIntent, currentScene);
      let executionScene = currentScene;
      let aiHistoryLabel = '本地规则';
      const creativeAiCandidate = isCreativeAiCandidate(transcript.text, localIntent.reason);
      let svgArtworkFallbackDiagnostics: SvgArtworkDiagnostics | undefined;

      const aiFallbackEnabled = settingsRef.current.aiFallbackEnabled;
      if (aiFallbackEnabled && (activeClarification || shouldUseAiIntentFallback(localIntent, plan, transcript))) {
        const aiReason = activeClarification ? activeClarification.question : plan.message ?? localIntent.reason;
        const wantsSvgArtwork = settingsRef.current.aiGenerationMode === 'safe-svg-artwork' && creativeAiCandidate && !activeClarification;
        const aiGeneratingMessage = wantsSvgArtwork
          ? 'AI 正在生成 SVG 插画，请先别继续说；后续语音会排队。'
          : activeClarification
            ? 'AI 正在结合上一轮澄清生成绘图方案，请先别继续说。'
            : AI_GENERATING_NOTICE;
        pushWorkflowEvent('AI 正在生成中', aiGeneratingMessage, 'info');
        setAiStatus({
          state: 'checking',
          message: aiGeneratingMessage
        });
        updateVoiceRuntime({ phase: 'processing', recentEvent: aiGeneratingMessage, lastError: null });
        let svgArtworkHandled = false;
        const applySvgArtworkResult = (svgResult: Awaited<ReturnType<typeof resolveAiSvgArtwork>>) => {
          if (svgResult.ok) {
            const sanitizeResult = sanitizeSvgArtwork(svgResult.artwork, transcript.text);
            if (sanitizeResult.ok && sanitizeResult.artwork) {
              const latestScene = sceneRef.current.revision === executionScene.revision ? executionScene : sceneRef.current;
              executionScene = latestScene;
              const artworkCommand = createSvgArtworkCommand(sanitizeResult.artwork, transcript.text);
              plan = {
                commands: [artworkCommand],
                message: `已生成安全 SVG 插画：${sanitizeResult.artwork.name}。`,
                svgArtworkDiagnostics: {
                  ...sanitizeResult.diagnostics,
                  rawSummary: svgResult.rawIntentSummary,
                  schemaVersion: svgResult.schemaVersion,
                  transcript: transcript.text
                }
              };
              aiHistoryLabel = 'DeepSeek SVG';
              setAiStatus({
                state: 'used',
                message: `DeepSeek 已生成安全 SVG 插画。`
              });
              pushWorkflowEvent('SVG 插画校验通过', `${sanitizeResult.diagnostics.sanitizedElementCount} 个安全元素。`, 'ok');
              return true;
            }
            svgArtworkFallbackDiagnostics = {
              ...sanitizeResult.diagnostics,
              sanitizerStatus: 'fallback',
              fallbackReason: sanitizeResult.reason ?? sanitizeResult.diagnostics.fallbackReason ?? 'SVG 插画校验失败。'
            };
            pushWorkflowEvent('SVG 插画已回退', svgArtworkFallbackDiagnostics.fallbackReason ?? '安全校验未通过。', 'warning');
            return false;
          }
          svgArtworkFallbackDiagnostics = createSvgFallbackDiagnostics(transcript.text, svgResult.reason);
          pushWorkflowEvent('SVG 插画已回退', svgResult.reason, 'warning');
          return false;
        };
        if (wantsSvgArtwork) {
          svgArtworkHandled = applySvgArtworkResult(await resolveAiSvgArtwork(transcript, executionScene, aiReason, undefined, getAiRequestOptions('safe-svg-artwork')));
          if (!svgArtworkHandled) {
            const fallbackMessage = 'SVG 插画没有生成成功，正在请求 AI 可编辑配方。';
            pushWorkflowEvent('AI 可编辑配方接管', fallbackMessage, 'warning');
            setAiStatus({
              state: 'checking',
              message: fallbackMessage
            });
          }
        }

        if (!svgArtworkHandled) {
          const aiResult = await resolveAiIntent(
            transcript,
            executionScene,
            aiReason,
            activeClarification ?? undefined,
            getAiRequestOptions('editable-recipe')
          );
          if (aiResult.ok) {
            const latestScene = sceneRef.current.revision === executionScene.revision ? executionScene : sceneRef.current;
            executionScene = latestScene;
            plan = planCommands(aiResult.intent, latestScene);
            if (plan.layoutDiagnostics) {
              plan = {
                ...plan,
                layoutDiagnostics: {
                  ...plan.layoutDiagnostics,
                  schemaVersion: aiResult.schemaVersion ?? plan.layoutDiagnostics.schemaVersion,
                  rawSummary: aiResult.rawIntentSummary ?? plan.layoutDiagnostics.rawSummary,
                  transcript: transcript.text
                },
                svgArtworkDiagnostics: svgArtworkFallbackDiagnostics
              };
            } else if (svgArtworkFallbackDiagnostics) {
              plan = { ...plan, svgArtworkDiagnostics: svgArtworkFallbackDiagnostics };
            }
            const svgFallbackReason = svgArtworkFallbackDiagnostics?.fallbackReason ?? '';
            const svgFallbackIsSlow = /仍在生成|优先使用/.test(svgFallbackReason);
            aiHistoryLabel = svgArtworkFallbackDiagnostics ? (svgFallbackIsSlow ? 'SVG 插画较慢，已用 AI 配方生成' : 'SVG 插画失败，已用可编辑配方生成') : 'DeepSeek';
            setAiStatus({
              state: 'used',
              message: svgArtworkDiagnosticsMessage(svgArtworkFallbackDiagnostics) ?? `DeepSeek 已解析为 ${aiResult.intent.type}。`
            });
          } else {
            aiHistoryLabel = 'AI 未接管';
            setAiStatus({
              state: 'fallback',
              message: aiResult.reason
            });
            plan = {
              commands: [],
              message: `AI 创作服务暂时不可用：${aiResult.reason}`,
              needsClarification: true,
              svgArtworkDiagnostics: svgArtworkFallbackDiagnostics
            };
          }
        }
      } else {
        setAiStatus({
          state: 'local',
          message: aiFallbackEnabled ? '本地规则已直接处理。' : 'AI 兜底已关闭，本地规则已处理。'
        });
      }

      if (!options.skipConfirmation && requiresVoiceConfirmation(transcript, plan.commands, executionScene)) {
        const message = confirmationMessageForCommands(plan.commands, executionScene);
        const nextConfirmation: PendingConfirmationState = {
          commandId: item.commandId,
          transcript,
          message,
          createdAt: performance.now(),
          expiresAt: performance.now() + CONFIRMATION_TTL_MS
        };
        pendingConfirmationRef.current = nextConfirmation;
        setPendingConfirmation(nextConfirmation);
        updateVoiceRuntime({ phase: 'processing', recentEvent: message });
        await publishResult(transcript, buildUiResult(message, currentScene, transcript, false), '安全确认', '等待危险操作确认');
        return;
      }

      const result = executeDrawingCommands(executionScene, plan.commands, transcript, plan);
      if (result.needsClarification) {
        const now = performance.now();
        const nextClarification: ClarificationState = {
          waiting: true,
          originalTranscript: activeClarification?.originalTranscript ?? transcript.text,
          question: result.message,
          reason: plan.message ?? localIntent.reason,
          createdAt: now,
          expiresAt: now + CLARIFICATION_TTL_MS
        };
        setClarification(nextClarification);
        clarificationRef.current = nextClarification;
      } else {
        setClarification(null);
        clarificationRef.current = null;
      }
      await publishResult(transcript, result, aiHistoryLabel);
    },
    [
      buildUiResult,
      clearPendingConfirmation,
      getAiRequestOptions,
      publishResult,
      pushWorkflowEvent,
      runAiConnectionTest,
      setSettings,
      setVoicePolicyMode,
      updateVoiceRuntime
    ]
  );

  const processCommandQueue = useCallback(async () => {
    if (processingQueueRef.current) return;
    processingQueueRef.current = true;
    updateVoiceRuntime({ phase: 'processing', recentEvent: '开始处理语音队列。' });
    try {
      let item = commandQueueRef.current.takeNext();
      refreshCommandQueueSnapshot();
      while (item) {
        try {
          await executeVoiceCommand(item);
          commandQueueRef.current.markCompleted(item.commandId);
        } catch (error) {
          commandQueueRef.current.markFailed(item.commandId, error);
          const message = error instanceof Error ? error.message : '语音指令执行失败。';
          updateVoiceRuntime({ phase: 'error', recentEvent: message, lastError: message });
        }
        item = commandQueueRef.current.takeNext();
        refreshCommandQueueSnapshot();
      }
    } finally {
      processingQueueRef.current = false;
      updateVoiceRuntime({ phase: voiceSpeakingRef.current ? 'speaking' : 'idle', recentEvent: '语音队列已处理完。' });
    }
  }, [executeVoiceCommand, refreshCommandQueueSnapshot, updateVoiceRuntime]);

  const handleTranscript = useCallback(
    async (transcript: VoiceTranscript) => {
      const normalizedTranscript = normalizeIncomingTranscript(transcript);
      if (isLikelyEcho(normalizedTranscript.text, lastSpokenTextRef.current) && performance.now() - lastSpokenAtRef.current < ECHO_GUARD_MS) {
        pushWorkflowEvent('已忽略系统回声', normalizedTranscript.text, 'info');
        updateVoiceRuntime({ phase: 'speaking', recentEvent: '已过滤系统朗读回声。' });
        return;
      }

      const queuedBefore = commandQueueRef.current.length;
      const { done } = commandQueueRef.current.enqueue(normalizedTranscript, sceneRef.current.revision);
      refreshCommandQueueSnapshot();
      updateVoiceRuntime({
        phase: processingQueueRef.current ? 'processing' : 'committing',
        recentEvent: queuedBefore || processingQueueRef.current ? `已排队：“${normalizedTranscript.text}”` : `已收到：“${normalizedTranscript.text}”`
      });
      if (queuedBefore || processingQueueRef.current) {
        pushWorkflowEvent('语音指令已排队', normalizedTranscript.text, 'info');
      }
      void processCommandQueue();
      await done;
    },
    [processCommandQueue, pushWorkflowEvent, refreshCommandQueueSnapshot, updateVoiceRuntime]
  );

  useEffect(() => {
    if (!isE2eMode()) return;
    window.__speak2drawTest = {
      submitTranscript: (text: string, confidence = 0.95) =>
        handleTranscript({
          text,
          confidence,
          receivedAt: performance.now(),
          isFinal: true,
          source: 'manual-test',
          utteranceId: `manual-${Date.now()}`,
          startedAt: performance.now(),
          committedAt: performance.now()
        }),
      getScene: () => sceneRef.current,
      getAiStatus: () => aiStatusRef.current,
      getClarification: () => clarificationRef.current,
      getVoiceDiagnostics: () => voiceDiagnosticsRef.current ?? EMPTY_VOICE_DIAGNOSTICS,
      getVoiceRuntime: () => voiceRuntimeRef.current,
      getCommandQueue: () => commandQueueRef.current.snapshot(),
      emitSpeechEvent: (event) =>
        handleTranscript({
          text: event.text ?? '',
          confidence: event.confidence ?? 0.8,
          receivedAt: performance.now(),
          isFinal: event.isFinal ?? event.source !== 'interim-fallback',
          source: event.source ?? (event.isFinal === false ? 'interim-fallback' : 'final'),
          utteranceId: `test-${Date.now()}`,
          startedAt: performance.now(),
          committedAt: performance.now()
        }),
      getSettings: () => toPublicSettingsSnapshot(settingsRef.current, sessionKeyConfigured),
      getWorkbenchLayout: () => workbenchLayoutRef.current
    };

    return () => {
      delete window.__speak2drawTest;
    };
  }, [handleTranscript, sessionKeyConfigured]);

  const shouldIgnoreTranscript = useCallback(
    (transcript: VoiceTranscript) =>
      isLikelyEcho(transcript.text, lastSpokenTextRef.current) && performance.now() - lastSpokenAtRef.current < ECHO_GUARD_MS,
    []
  );

  const { status, error, activity, diagnostics, start, stop } = useSpeechInput(handleTranscript, {
    policyMode: voicePolicyMode,
    suspended: voiceSpeaking,
    shouldIgnoreTranscript
  });
  const selected = useMemo(() => scene.objects.find((object) => object.id === scene.selectedId), [scene.objects, scene.selectedId]);

  useEffect(() => {
    voiceDiagnosticsRef.current = diagnostics;
    const diagnosticPhase = runtimePhaseFromDiagnostics(diagnostics);
    const phase = voiceSpeakingRef.current ? 'speaking' : processingQueueRef.current ? 'processing' : diagnosticPhase;
    const recentEvent =
      processingQueueRef.current && diagnosticPhase !== 'error'
        ? voiceRuntimeRef.current.recentEvent
        : diagnostics.reason ?? diagnostics.finalText ?? diagnostics.interimText ?? activity;
    updateVoiceRuntime({
      phase,
      recentEvent,
      lastError: diagnostics.phase === 'error' || diagnostics.phase === 'no_speech' ? diagnostics.reason : null
    });
  }, [activity, diagnostics, updateVoiceRuntime]);

  useEffect(() => {
    if (!toastEvent) return;
    const timer = window.setTimeout(() => setToastEvent(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toastEvent]);

  useEffect(() => {
    const workflow = workflowLabelForDiagnostics(diagnostics, settings.showInterimTranscript);
    if (!workflow) return;
    const workflowKey = `${diagnostics.phase}:${settings.showInterimTranscript ? diagnostics.interimText ?? '' : ''}:${diagnostics.finalText ?? ''}:${diagnostics.reason ?? ''}`;
    if (workflowKey === lastWorkflowKeyRef.current) return;
    lastWorkflowKeyRef.current = workflowKey;
    pushWorkflowEvent(workflow.title, workflow.detail, workflow.tone);
  }, [diagnostics.phase, diagnostics.finalText, diagnostics.interimText, diagnostics.reason, pushWorkflowEvent, settings.showInterimTranscript]);

  const submitStudioCommand = useCallback<CommandAction>(
    (text) =>
      handleTranscript({
        text,
        confidence: 0.99,
        receivedAt: performance.now(),
        isFinal: true
      }),
    [handleTranscript]
  );

  const handleMicrophoneTest = useCallback(async () => {
    if (status === 'listening' || status === 'starting') stop();
    setMicTestStatus('testing');
    setMicTestResult(null);
    setMicTestSample(null);
    setMicTestLevels([]);
    pushWorkflowEvent('麦克风测试开始', '正在采样真实输入音量。', 'info');
    const result = await runMicrophoneInputTest(3000, (sample) => {
      setMicTestSample(sample);
      setMicTestLevels((levels) => [...levels.slice(-43), sample.average]);
    });
    setMicTestResult(result);
    setMicTestStatus('idle');
    pushWorkflowEvent(result.ok ? '麦克风测试通过' : '麦克风测试异常', result.message, result.ok ? 'ok' : 'warning');
  }, [pushWorkflowEvent, status, stop]);

  if (showLanding) {
    return <NavigationLanding onEnter={enterWorkbench} />;
  }

  return (
    <main className="app-shell">
      <section className="studio-shell" aria-label="语音绘图工作台">
        <MobileVoiceDock
          status={status}
          error={error}
          activity={activity}
          diagnostics={diagnostics}
          showInterimTranscript={settings.showInterimTranscript}
          lastTranscript={lastTranscript}
          onStatusPanelOpen={() => setStatusPanelOpen(true)}
          onSettingsOpen={() => setSettingsOpen(true)}
          start={start}
          stop={stop}
        />
        {settingsOpen ? (
          <SettingsWorkspace
            settings={settings}
            activeTab={activeSettingsTab}
            aiConnectionStatus={aiConnectionStatus}
            sessionKeyConfigured={sessionKeyConfigured}
            diagnostics={diagnostics}
            objectCount={scene.objects.length}
            onTabChange={setActiveSettingsTab}
            onSettingsChange={setSettings}
            onSessionKeyChange={(value) => {
              sessionApiKeyRef.current = value.trim();
              setSessionKeyConfigured(Boolean(value.trim()));
            }}
            onClearSessionKey={() => {
              sessionApiKeyRef.current = '';
              setSessionKeyConfigured(false);
            }}
            onReset={() => {
              const next = resetAppSettings();
              setSettings(next);
              setVoicePolicyMode(next.voicePolicyMode);
            }}
            onTestConnection={runAiConnectionTest}
            onClose={() => setSettingsOpen(false)}
          />
        ) : (
          <div className={`studio-console layout-${workbenchLayout}`}>
            <DiagnosticsColumn
              status={status}
              error={error}
              activity={activity}
              diagnostics={diagnostics}
              showInterimTranscript={settings.showInterimTranscript}
              clarification={clarification}
              lastResult={lastResult}
              lastTranscript={lastTranscript}
              history={history}
              voicePolicyMode={voicePolicyMode}
              aiStatus={aiStatus}
              micTestStatus={micTestStatus}
              micTestResult={micTestResult}
              micTestSample={micTestSample}
              micTestLevels={micTestLevels}
              onMicrophoneTest={handleMicrophoneTest}
              onCommand={submitStudioCommand}
              onStatusPanelOpen={() => setStatusPanelOpen(true)}
              onPolicyModeChange={setVoicePolicyMode}
              start={start}
              stop={stop}
            />

            <div className="studio-main">
              <CanvasStage
                scene={scene}
                selected={selected}
                hintsCollapsed={canvasHintsCollapsed}
                layout={workbenchLayout}
                onLayoutChange={setWorkbenchLayout}
                onStatusPanelOpen={() => setStatusPanelOpen(true)}
                onSettingsOpen={() => setSettingsOpen(true)}
                onToggleHints={() => setCanvasHintsCollapsed((collapsed) => !collapsed)}
              />
              <CanvasActionBar onCommand={submitStudioCommand} />
            </div>
            {workbenchLayout === 'side-inspector' ? (
              <ObjectWorkbench
                variant="side"
                selected={selected}
                scene={scene}
                lastTranscript={lastTranscript}
                lastResult={lastResult}
                aiStatus={aiStatus}
                onCommand={submitStudioCommand}
              />
            ) : null}
            {workbenchLayout === 'bottom-inspector' ? (
              <ObjectWorkbench
                variant="bottom"
                selected={selected}
                scene={scene}
                lastTranscript={lastTranscript}
                lastResult={lastResult}
                aiStatus={aiStatus}
                onCommand={submitStudioCommand}
              />
            ) : null}
          </div>
        )}
        {!settingsOpen && !statusPanelOpen && toastEvent ? <WorkflowToast event={toastEvent} /> : null}
        {statusPanelOpen ? (
          <StatusOverlay
            status={status}
            diagnostics={diagnostics}
            showInterimTranscript={settings.showInterimTranscript}
            generationMode={settings.aiGenerationMode}
            aiStatus={aiStatus}
            selected={selected}
            selection={scene.selection}
            objectCount={scene.objects.length}
            lastResult={lastResult}
            lastTranscript={lastTranscript}
            clarification={clarification}
            voiceRuntime={voiceRuntime}
            pendingConfirmation={pendingConfirmation}
            history={history}
            workflowEvents={workflowEvents}
            micTestSample={micTestSample}
            micTestLevels={micTestLevels}
            onClose={() => setStatusPanelOpen(false)}
            onCommand={submitStudioCommand}
          />
        ) : null}
      </section>
    </main>
  );
};

const NavigationLanding = ({ onEnter }: { onEnter: () => void }) => {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeFlowIndex, setActiveFlowIndex] = useState<number | null>(null);
  const [pinnedFlowIndex, setPinnedFlowIndex] = useState<number | null>(null);
  const title = Array.from('AI 语音绘图工具');
  const highlights = ['纯语音控制', '原话驱动 AI', '安全 SVG 插画', '局部可编辑'];
  const infoColumns = [
    {
      icon: <Radio size={15} />,
      title: '说出想法',
      detail: '从一句中文语音开始，不需要鼠标或键盘。',
      what: '浏览器麦克风持续收音，把用户说出的完整想法整理成可解析文本，例如“画一个戴帽子的狗”。',
      why: '纯语音绘图最怕半句话就执行。系统会等待端点稳定，并把未听清、低置信度和超时状态单独反馈。',
      proof: '已实现麦克风测试、收音波形、端点策略、无清晰语音提示和语音状态浮层。',
      example: '试试说：画一个红色圆形。'
    },
    {
      icon: <BrainCircuit size={15} />,
      title: '理解意图',
      detail: '原话进入 AI，再用固定 JSON 合同约束输出。',
      what: '系统会把 originalTranscript 和 SVG 生成要求一起交给 AI，让 AI 理解用户原话，而不是只依赖本地关键词映射。',
      why: '把“听到的原话”和“可执行的绘图结构”分开，能减少听见了但画错、局部改错或返回不安全内容的风险。',
      proof: 'AI 必须返回受控 JSON 指令；SVG 插画要经过本地安全清洗，设置页也能测试 AI 连接和切换生图模式。',
      example: '试试说：把帽子删掉，不好看。'
    },
    {
      icon: <Layers3 size={15} />,
      title: '拆解步骤',
      detail: '把复杂创作拆成对象、部件和可撤销命令。',
      what: '复杂对象会保留素材组和局部部件，例如狗可以包含脸、耳朵、眼睛、帽檐和帽冠。',
      why: '用户后续要改局部时，系统能知道“帽子”和“整只小狗”的区别。',
      proof: '已支持素材组选择、局部选择、删除帽子不删除主体、复杂指令批量执行。',
      example: '试试说：选择房子的窗户。'
    },
    {
      icon: <CheckCircle2 size={15} />,
      title: '执行反馈',
      detail: '画布更新、历史记录和状态解释同步出现。',
      what: '绘图命令会更新 SVG 场景模型，并记录执行结果、失败原因、撤销栈、安全清洗状态和语音反馈。',
      why: '用户看不到底层操作，所以每一步都要告诉用户系统理解了什么、执行了什么，以及 AI 是否正在生成。',
      proof: '已实现撤销重做、清空导出、状态信息浮层、AI 状态说明、SVG 清洗诊断和延迟指标。',
      example: '试试说：打开状态信息。'
    }
  ];
  const visibleFlowIndex = previewOpen ? (pinnedFlowIndex ?? activeFlowIndex) : null;
  const visibleFlow = visibleFlowIndex === null ? null : infoColumns[visibleFlowIndex];
  const keywordRows = [
    ['语音端点检测', '原话驱动 AI', '低置信度澄清', '复杂指令拆解', '安全 SVG 插画', '局部对象编辑', 'SVG 安全清洗', '撤销重做记录'],
    ['戴帽子的狗', '删除帽子', '选择房子窗户', '打开状态信息', '测试 AI 连接', '导出 SVG', '清空画布', '恢复画布模式']
  ];
  const closePreview = () => {
    setPreviewOpen(false);
    setActiveFlowIndex(null);
    setPinnedFlowIndex(null);
  };
  const togglePreview = () => {
    setPreviewOpen((open) => {
      if (open) {
        setActiveFlowIndex(null);
        setPinnedFlowIndex(null);
      }
      return !open;
    });
  };

  return (
    <main className={`landing-shell${previewOpen ? ' preview-open' : ''}`} aria-label="Speak2Draw 导航页">
      <div className="landing-background" aria-hidden="true" />
      <header className="landing-nav" aria-label="导航">
        <img className="landing-brand-logo" src="/qiniu-xengineer-logo.png" alt="七牛云 XEngineer" />
        <span>canan</span>
        <button type="button" onClick={onEnter}>
          进入
        </button>
      </header>

      <section className="landing-hero" aria-label="进入工作台">
        <h1 className="landing-title" aria-label="AI 语音绘图工具">
          {title.map((letter, index) => (
            <span
              aria-hidden="true"
              className="landing-title-letter"
              key={`${letter}-${index}`}
              style={{ '--letter-index': index } as CSSProperties}
            >
              {letter === ' ' ? '\u00A0' : letter}
            </span>
          ))}
        </h1>
        <p className="landing-subtitle">只用语音完成绘图创作，AI 理解原话并生成安全 SVG 插画。</p>
        <button className="landing-primary-button" type="button" onClick={onEnter}>
          <span>Speak2Draw-Agent-Studio</span>
          <strong>
            <span className="landing-enter-label">进入工作台</span>
            <ArrowRight size={16} />
          </strong>
        </button>
        <ul className="landing-highlight-strip" aria-label="项目亮点">
          {highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="landing-keyword-stream" aria-hidden="true">
        {keywordRows.map((row, rowIndex) => (
          <div className={`keyword-lane lane-${rowIndex + 1}`} key={rowIndex}>
            <div className="keyword-track">
              {[...row, ...row].map((word, index) => (
                <span key={`${word}-${index}`}>{word}</span>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section
        className={`landing-info-panel${previewOpen ? ' is-open' : ''}`}
        aria-label="产品信息面板"
        onMouseLeave={() => {
          if (pinnedFlowIndex === null) setActiveFlowIndex(null);
        }}
      >
        <button className="landing-info-close" type="button" aria-label="关闭产品信息面板" onClick={closePreview}>
          <X size={17} />
        </button>
        {infoColumns.map((item, index) => (
          <article className={visibleFlowIndex === index ? 'is-active' : ''} key={item.title} style={{ '--info-index': index } as CSSProperties}>
            <button
              className="landing-flow-card"
              type="button"
              aria-pressed={pinnedFlowIndex === index}
              aria-describedby={visibleFlowIndex === index ? 'landing-flow-detail' : undefined}
              onClick={() => {
                setPinnedFlowIndex((current) => (current === index ? null : index));
                setActiveFlowIndex(index);
              }}
              onFocus={() => setActiveFlowIndex(index)}
              onMouseEnter={() => setActiveFlowIndex(index)}
            >
              <span className="landing-info-icon" aria-hidden="true">
                {item.icon}
              </span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </button>
          </article>
        ))}
        {visibleFlow ? (
          <aside
            className="landing-flow-detail"
            id="landing-flow-detail"
            aria-live="polite"
            style={{ '--active-flow-left': `${((visibleFlowIndex ?? 0) + 0.5) * 25}%` } as CSSProperties}
          >
            <button
              className="landing-flow-detail-close"
              type="button"
              aria-label="关闭流程详情"
              onClick={() => {
                setActiveFlowIndex(null);
                setPinnedFlowIndex(null);
              }}
            >
              <X size={14} />
            </button>
            <span>{String((visibleFlowIndex ?? 0) + 1).padStart(2, '0')}</span>
            <h2>{visibleFlow.title}</h2>
            <dl>
              <div>
                <dt>这一步做什么</dt>
                <dd>{visibleFlow.what}</dd>
              </div>
              <div>
                <dt>为什么重要</dt>
                <dd>{visibleFlow.why}</dd>
              </div>
              <div>
                <dt>如何保证靠谱</dt>
                <dd>{visibleFlow.proof}</dd>
              </div>
              <div>
                <dt>示例语音</dt>
                <dd>{visibleFlow.example}</dd>
              </div>
            </dl>
          </aside>
        ) : null}
      </section>

      <section
        className="landing-ink-card"
        aria-label="产品预览图"
        aria-pressed={previewOpen}
        onClick={togglePreview}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            togglePreview();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="ink-card-surface" />
      </section>
    </main>
  );
};

const VoiceTopDeck = ({
  status,
  error,
  activity,
  diagnostics,
  showInterimTranscript,
  lastTranscript,
  lastResult,
  voicePolicyMode,
  onPolicyModeChange,
  start,
  stop
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  diagnostics: SpeechDiagnostics;
  showInterimTranscript: boolean;
  lastTranscript: string;
  lastResult: ExecutionResult | null;
  voicePolicyMode: EndpointPolicyMode;
  onPolicyModeChange: (mode: EndpointPolicyMode) => void;
  start: () => void;
  stop: () => void;
}) => {
  const listening = status === 'listening';
  const starting = status === 'starting';
  const stageText = (showInterimTranscript ? diagnostics.interimText : null) ?? diagnostics.finalText ?? (activity || lastResult?.message || '检测到停顿');
  const canCancelStart = listening || starting;

  return (
    <header className={`voice-command-bar ${status}`}>
      <div className="top-title">
        <h1>纯语音绘图工作台</h1>
        <p>Speak2Draw-Agent-Studio</p>
      </div>
      <button
        className={`mic-control ${canCancelStart ? 'active' : ''}`}
        onClick={canCancelStart ? stop : start}
        disabled={status === 'unsupported'}
        title={canCancelStart ? '停止语音监听' : '启动语音监听'}
        aria-label={canCancelStart ? '停止语音监听' : '启动语音监听'}
      >
        {canCancelStart ? <MicOff size={24} /> : <Mic size={24} />}
      </button>
      <div className="top-state">
        <strong>{voiceStatusLabel(status)}</strong>
        <ChevronDown size={17} />
      </div>

      <div className="control-strip">
        <div className="status-select">
          <Radio size={17} />
          <span>{voiceStatusMessage(status, error, activity)}</span>
          <ChevronDown size={17} />
        </div>
        <button
          className={`policy-pill ${voicePolicyMode === 'fast' ? 'active' : ''}`}
          type="button"
          title="快速响应模式"
          aria-pressed={voicePolicyMode === 'fast'}
          onClick={() => onPolicyModeChange('fast')}
        >
          <span>fast</span>
          <ChevronDown size={17} />
        </button>
        <div className="transcript-command" title={lastTranscript}>
          <span>{stageText}</span>
          <ChevronRight size={20} />
        </div>
        <button
          className={`mode-pill primary ${voicePolicyMode === 'balanced' ? 'active' : ''}`}
          type="button"
          title="本地与 AI 平衡模式"
          aria-pressed={voicePolicyMode === 'balanced'}
          onClick={() => onPolicyModeChange('balanced')}
        >
          <Bot size={18} />
          <span>balanced</span>
        </button>
        <button
          className={`mode-pill ${voicePolicyMode === 'patient' ? 'active' : ''}`}
          type="button"
          title="耐心监听模式"
          aria-pressed={voicePolicyMode === 'patient'}
          onClick={() => onPolicyModeChange('patient')}
        >
          <GaugeCircle size={18} />
          <span>patient</span>
          <ChevronDown size={17} />
        </button>
      </div>
    </header>
  );
};

const MobileVoiceDock = ({
  status,
  error,
  activity,
  diagnostics,
  showInterimTranscript,
  lastTranscript,
  onStatusPanelOpen,
  onSettingsOpen,
  start,
  stop
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  diagnostics: SpeechDiagnostics;
  showInterimTranscript: boolean;
  lastTranscript: string;
  onStatusPanelOpen: () => void;
  onSettingsOpen: () => void;
  start: () => void;
  stop: () => void;
}) => {
  const canCancelStart = status === 'listening' || status === 'starting';
  const liveText = (showInterimTranscript ? diagnostics.interimText : null) ?? diagnostics.finalText ?? (lastTranscript === '等待语音指令' ? activity : lastTranscript);
  return (
    <section className={`mobile-voice-dock ${status}`} aria-label="移动端语音入口">
      <button
        className={`mobile-mic-button ${canCancelStart ? 'active' : ''}`}
        type="button"
        aria-label={canCancelStart ? '停止语音监听' : '启动语音监听'}
        onClick={canCancelStart ? stop : start}
      >
        {canCancelStart ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      <div className="mobile-voice-copy">
        <h1>纯语音绘图工作台</h1>
        <strong>{error?.title ?? voiceStatusLabel(status)}</strong>
        <span>{liveText}</span>
      </div>
      <button className="mobile-status-button" type="button" onClick={onStatusPanelOpen}>
        状态
      </button>
      <button className="mobile-status-button" type="button" onClick={onSettingsOpen}>
        设置
      </button>
    </section>
  );
};

const DiagnosticsColumn = ({
  status,
  error,
  activity,
  diagnostics,
  showInterimTranscript,
  clarification,
  lastResult,
  lastTranscript,
  history,
  voicePolicyMode,
  aiStatus,
  micTestStatus,
  micTestResult,
  micTestSample,
  micTestLevels,
  onMicrophoneTest,
  onCommand,
  onStatusPanelOpen,
  onPolicyModeChange,
  start,
  stop
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  diagnostics: SpeechDiagnostics;
  showInterimTranscript: boolean;
  clarification: ClarificationState | null;
  lastResult: ExecutionResult | null;
  lastTranscript: string;
  history: HistoryItem[];
  voicePolicyMode: EndpointPolicyMode;
  aiStatus: AiResolutionStatus;
  micTestStatus: 'idle' | 'testing';
  micTestResult: MicrophoneTestResult | null;
  micTestSample: MicrophoneInputSample | null;
  micTestLevels: number[];
  onMicrophoneTest: () => void;
  onCommand: CommandAction;
  onStatusPanelOpen: () => void;
  onPolicyModeChange: (mode: EndpointPolicyMode) => void;
  start: () => void;
  stop: () => void;
}) => {
  return (
    <aside className="diagnostics-column column-card" aria-label="语音控制栏">
      <VoiceTopDeck
        status={status}
        error={error}
        activity={activity}
        diagnostics={diagnostics}
        showInterimTranscript={showInterimTranscript}
        lastTranscript={lastTranscript}
        lastResult={lastResult}
        voicePolicyMode={voicePolicyMode}
        onPolicyModeChange={onPolicyModeChange}
        start={start}
        stop={stop}
      />
      <div className="soft-divider" />
      <VoiceControlPanel status={status} error={error} activity={activity} diagnostics={diagnostics} showInterimTranscript={showInterimTranscript} lastTranscript={lastTranscript} history={history} voicePolicyMode={voicePolicyMode} onCommand={onCommand} />

      <div className="soft-divider" />
      <StatusSummary aiStatus={aiStatus} diagnostics={diagnostics} onOpen={onStatusPanelOpen} />
      <div className="soft-divider" />
      <MicrophoneTestBlock status={micTestStatus} result={micTestResult} sample={micTestSample} levels={micTestLevels} onTest={onMicrophoneTest} />
      {clarification ? <InfoBlock title="等待补充" value={clarification.question} tone="warning" /> : null}
      <InfoBlock title="系统反馈" value={lastResult?.message ?? '启动监听后，说出绘图指令。'} tone={lastResult?.ok === false || error ? 'warning' : 'default'} />
      <div className="soft-divider" />
      <CommandGuide onCommand={onCommand} />
      <HistoryTimeline history={history} />
    </aside>
  );
};

const VoiceControlPanel = ({
  status,
  error,
  activity,
  diagnostics,
  showInterimTranscript,
  lastTranscript,
  history,
  voicePolicyMode,
  onCommand
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  diagnostics: SpeechDiagnostics;
  showInterimTranscript: boolean;
  lastTranscript: string;
  history: HistoryItem[];
  voicePolicyMode: EndpointPolicyMode;
  onCommand: CommandAction;
}) => {
  const liveText = (showInterimTranscript ? diagnostics.interimText : null) ?? diagnostics.finalText ?? (lastTranscript === '等待语音指令' ? '' : lastTranscript);
  const recentItems = history.length ? history.slice(0, 3) : EMPTY_RECENT_COMMANDS;
  const showingExamples = history.length === 0;
  return (
    <section className="column-section voice-control-panel">
      <div className="panel-heading spaced">
        <div className="section-label">
          <Radio size={17} />
          <h2>语音控制</h2>
        </div>
        <span className={`tiny-state ${status}`}>{voiceStatusLabel(status)}</span>
      </div>

      <div className="voice-core">
        <div className={`voice-orb ${status}`} aria-hidden="true">
          <Mic size={38} />
          <span />
        </div>
        <div className="voice-state-stack">
          <small>当前状态</small>
          <strong>{error?.title ?? voiceStatusLabel(status)}</strong>
          <p>{activity || error?.message || '等待下一条绘图语音。'}</p>
        </div>
      </div>

      <div className="live-transcript">
        <span>实时识别文本</span>
        <strong>{liveText || '等待语音输入...'}</strong>
      </div>

      <div className="recent-command-list" aria-label="最近指令">
        <span>{showingExamples ? '示例指令' : '最近指令'}</span>
        {recentItems.map((item, index) => (
          <button key={`${item.transcript}-${index}`} type="button" onClick={() => void onCommand(item.transcript)}>
            <strong>{item.transcript}</strong>
            <small>{item.time ?? (showingExamples ? '示例' : '')}</small>
          </button>
        ))}
      </div>

      <div className="voice-activity-row" aria-label="语音活动">
        <span className={status === 'listening' ? 'active' : ''}>正在识别</span>
        <span className={diagnostics.reason ? 'warning' : ''}>{diagnostics.reason ? '检测到停顿' : '声音清晰'}</span>
        <span className={status === 'listening' || status === 'starting' ? 'active' : ''}>等待下一条指令</span>
      </div>

      <div className="strategy-tabs" aria-label="端点策略">
        <span className={voicePolicyMode === 'fast' ? 'active' : ''}>fast</span>
        <strong className={voicePolicyMode === 'balanced' ? 'active' : ''}>balanced</strong>
        <span className={voicePolicyMode === 'patient' ? 'active' : ''}>patient</span>
      </div>

      <div className="script-buttons compact" aria-label="语音样例">
        <button type="button" onClick={() => void onCommand('画一个黄色太阳')}>画太阳</button>
        <button type="button" onClick={() => void onCommand('把房子向右移动一点')}>移动房子</button>
      </div>
    </section>
  );
};

const CanvasStage = ({
  scene,
  selected,
  hintsCollapsed,
  layout,
  onLayoutChange,
  onStatusPanelOpen,
  onSettingsOpen,
  onToggleHints
}: {
  scene: SceneState;
  selected?: SceneObject;
  hintsCollapsed: boolean;
  layout: WorkbenchLayout;
  onLayoutChange: (layout: WorkbenchLayout) => void;
  onStatusPanelOpen: () => void;
  onSettingsOpen: () => void;
  onToggleHints: () => void;
}) => (
  <section className={`canvas-stage canvas-panel ${hintsCollapsed ? 'hints-collapsed' : ''}`} aria-label="绘图画布">
    <div className="canvas-titlebar">
      <span>{hintsCollapsed ? '提示已收起' : '960x600'}</span>
      <button
        type="button"
        aria-label={hintsCollapsed ? '显示画布提示' : '收起画布提示'}
        aria-pressed={hintsCollapsed}
        title={hintsCollapsed ? '显示画布提示' : '收起画布提示'}
        onClick={onToggleHints}
      >
        <X size={18} />
      </button>
    </div>
    <CanvasLayoutControls
      layout={layout}
      selectedName={selected?.groupName ?? selected?.partName ?? selected?.name ?? '未选中'}
      onLayoutChange={onLayoutChange}
      onStatusPanelOpen={onStatusPanelOpen}
      onSettingsOpen={onSettingsOpen}
    />
    <div className="canvas-surface">
      {!hintsCollapsed ? (
        <div className="axis-y" aria-hidden="true">
          {[0, 100, 200, 300, 400, 500, 600].map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      ) : null}
      <DrawingCanvas scene={scene} />
      {scene.objects.length === 0 ? (
        <div className="empty-canvas-hint">
          <Sparkles size={18} />
          <strong>试试说：画一个红色圆形</strong>
        </div>
      ) : null}
      {!hintsCollapsed ? (
        <div className="axis-x" aria-hidden="true">
          {[0, 120, 240, 360, 480, 600, 720, 840, 960].map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  </section>
);

const CanvasLayoutControls = ({
  layout,
  selectedName,
  onLayoutChange,
  onStatusPanelOpen,
  onSettingsOpen
}: {
  layout: WorkbenchLayout;
  selectedName: string;
  onLayoutChange: (layout: WorkbenchLayout) => void;
  onStatusPanelOpen: () => void;
  onSettingsOpen: () => void;
}) => {
  const sideOpen = layout === 'side-inspector';
  const bottomOpen = layout === 'bottom-inspector';
  return (
    <div className="canvas-layout-controls" aria-label="画布布局控制">
      <div className="canvas-control-card">
        <button
          type="button"
          aria-label={sideOpen ? '隐藏对象检查器' : '显示右侧对象检查器'}
          title={sideOpen ? '隐藏对象检查器' : '显示右侧对象检查器'}
          aria-pressed={sideOpen}
          onClick={() => onLayoutChange(sideOpen ? 'focus' : 'side-inspector')}
        >
          {sideOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
        <button
          type="button"
          aria-label={bottomOpen ? '关闭底部对象检查器' : '显示底部对象检查器'}
          title={bottomOpen ? '关闭底部对象检查器' : '显示底部对象检查器'}
          aria-pressed={bottomOpen}
          onClick={() => onLayoutChange(bottomOpen ? 'focus' : 'bottom-inspector')}
        >
          {bottomOpen ? <PanelBottomClose size={15} /> : <PanelBottomOpen size={15} />}
        </button>
        <button type="button" aria-label="打开状态信息" title="打开状态信息" onClick={onStatusPanelOpen}>
          <GaugeCircle size={15} />
        </button>
        <button type="button" aria-label="打开设置" title="打开设置" onClick={onSettingsOpen}>
          <Settings size={15} />
        </button>
      </div>
      <div className="canvas-micro-tags" aria-label="画布状态提示">
        <span title={selectedName}>{selectedName}</span>
        <span>SVG</span>
      </div>
    </div>
  );
};

const CanvasActionBar = ({ onCommand, compact = false }: { onCommand: CommandAction; compact?: boolean }) => (
  <section className={`canvas-action-bar ${compact ? 'compact' : ''}`} aria-label="画布操作">
    <div className="section-label">
      <Layers3 size={17} />
      <h2>画布操作</h2>
    </div>
    <div className="canvas-action-buttons">
      <button type="button" onClick={() => void onCommand('撤销')}>
        <Undo2 size={18} />
        撤销
      </button>
      <button type="button" onClick={() => void onCommand('重做')}>
        <Redo2 size={18} />
        重做
      </button>
      <button type="button" onClick={() => void onCommand('清空画布')}>
        <Trash2 size={18} />
        清空画布
      </button>
      <button type="button" onClick={() => void onCommand('导出图片')}>
        <Download size={18} />
        导出 SVG
      </button>
      <button type="button" onClick={() => void onCommand('我能说什么')}>
        <HelpCircle size={18} />
        帮助
      </button>
    </div>
  </section>
);

const DrawingCanvas = ({ scene }: { scene: SceneState }) => {
  const selectedObject = scene.objects.find((item) => item.id === scene.selectedId);
  const selectedGroupObjects = scene.selection?.scope === 'group' ? scene.objects.filter((object) => object.groupId === scene.selection?.groupId) : [];
  const selectedGroupBounds = selectedGroupObjects.length ? getObjectBounds(selectedGroupObjects) : null;
  const selectedPartObjects =
    scene.selection?.scope === 'part' && selectedObject?.partId && selectedObject.kind !== 'svg_artwork'
      ? scene.objects.filter((object) => object.partId === selectedObject.partId)
      : [];
  const selectedArtworkPartBounds =
    scene.selection?.scope === 'part' && selectedObject?.kind === 'svg_artwork'
      ? getSvgArtworkPartBounds(selectedObject, scene.selection.partId, scene.selection.partName)
      : null;
  const selectedPartBounds = selectedArtworkPartBounds ?? (selectedPartObjects.length > 1 ? getObjectBounds(selectedPartObjects) : null);
  const selectedPartLabel = scene.selection?.scope === 'part' ? scene.selection.partName ?? selectedObject?.partName ?? selectedObject?.name ?? '局部' : '局部';

  return (
    <svg className="drawing-canvas" viewBox="0 0 960 600" role="img" aria-label="语音绘图画布">
      <defs>
        <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#e7edf5" strokeWidth="1" />
        </pattern>
        <pattern id="major-grid" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#d9e2ef" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect width="960" height="600" fill="#ffffff" />
      <rect width="960" height="600" fill="url(#grid)" />
      <rect width="960" height="600" fill="url(#major-grid)" opacity="0.8" />
      <line x1="0" y1="492" x2="960" y2="492" stroke="#aeb9c8" strokeWidth="2" />
      {scene.objects.map((object) => (
        <SceneObjectView key={object.id} object={object} selected={!selectedGroupBounds && !selectedPartBounds && object.id === scene.selectedId} />
      ))}
      {selectedGroupBounds ? <GroupSelectionBox bounds={selectedGroupBounds} label={selectedObject?.groupName ?? selectedObject?.name ?? '素材组'} /> : null}
      {selectedPartBounds ? <PartSelectionBox bounds={selectedPartBounds} label={selectedPartLabel} /> : null}
    </svg>
  );
};

const GroupSelectionBox = ({ bounds, label }: { bounds: { x: number; y: number; width: number; height: number }; label: string }) => (
  <g className="group-selection-box" aria-label={`${label}素材组选中框`}>
    <rect x={bounds.x - 14} y={bounds.y - 14} width={bounds.width + 28} height={bounds.height + 28} rx="10" />
    <text x={bounds.x - 10} y={Math.max(18, bounds.y - 22)}>
      {label}
    </text>
    <circle cx={bounds.x - 14} cy={bounds.y - 14} r="5" />
    <circle cx={bounds.x + bounds.width + 14} cy={bounds.y - 14} r="5" />
    <circle cx={bounds.x - 14} cy={bounds.y + bounds.height + 14} r="5" />
    <circle cx={bounds.x + bounds.width + 14} cy={bounds.y + bounds.height + 14} r="5" />
  </g>
);

const PartSelectionBox = ({ bounds, label }: { bounds: { x: number; y: number; width: number; height: number }; label: string }) => (
  <g className="part-selection-box selection-box" aria-label={`${label}局部选中框`}>
    <rect x={bounds.x - 10} y={bounds.y - 10} width={bounds.width + 20} height={bounds.height + 20} rx="8" />
    <text x={bounds.x - 6} y={Math.max(18, bounds.y - 16)}>
      {label}
    </text>
  </g>
);

const SceneObjectView = ({ object, selected }: { object: SceneObject; selected: boolean }) => {
  const selection = selected ? (
    <g className="selection-box">
      <rect x={object.x - 10} y={object.y - 10} width={object.width + 20} height={object.height + 20} rx="8" />
      <line x1={object.x + object.width / 2} y1={object.y - 22} x2={object.x + object.width / 2} y2={object.y - 6} />
      <line x1={object.x + object.width / 2} y1={object.y + object.height + 6} x2={object.x + object.width / 2} y2={object.y + object.height + 22} />
      <line x1={object.x - 22} y1={object.y + object.height / 2} x2={object.x - 6} y2={object.y + object.height / 2} />
      <line x1={object.x + object.width + 6} y1={object.y + object.height / 2} x2={object.x + object.width + 22} y2={object.y + object.height / 2} />
    </g>
  ) : null;
  if (object.kind === 'circle') {
    const radius = Math.min(object.width, object.height) / 2;
    return (
      <g className="scene-object">
        {selection}
        <circle cx={object.x + radius} cy={object.y + radius} r={radius} {...svgStyle(object)} />
      </g>
    );
  }
  if (object.kind === 'ellipse') {
    return (
      <g className="scene-object">
        {selection}
        <ellipse cx={object.x + object.width / 2} cy={object.y + object.height / 2} rx={object.width / 2} ry={object.height / 2} {...svgStyle(object)} />
      </g>
    );
  }
  if (object.kind === 'line') {
    return (
      <g className="scene-object">
        {selection}
        <line x1={object.x} y1={object.y} x2={object.x + object.width} y2={object.y + object.height} stroke={object.style.stroke} strokeWidth={object.style.strokeWidth} strokeLinecap="round" />
      </g>
    );
  }
  if (object.kind === 'triangle') {
    const points = `${object.x + object.width / 2},${object.y} ${object.x + object.width},${object.y + object.height} ${object.x},${object.y + object.height}`;
    return (
      <g className="scene-object">
        {selection}
        <polygon points={points} {...svgStyle(object)} />
      </g>
    );
  }
  if (object.kind === 'text') {
    return (
      <g className="scene-object">
        {selection}
        <text x={object.x} y={object.y + object.height / 2} fill={object.style.stroke} fontSize="44" fontFamily='"Segoe UI", "Microsoft YaHei", sans-serif'>
          {object.text ?? '文字'}
        </text>
      </g>
    );
  }
  if (object.kind === 'svg_artwork') {
    return (
      <g className="scene-object svg-artwork-object">
        {selection}
        <svg
          x={object.x}
          y={object.y}
          width={object.width}
          height={object.height}
          viewBox={safeArtworkViewBox(object.svgArtwork?.viewBox)}
          role="img"
          aria-label={object.svgArtwork?.name ?? object.name}
          dangerouslySetInnerHTML={{ __html: object.svgArtwork?.safeMarkup ?? '' }}
        />
      </g>
    );
  }
  return (
    <g className="scene-object">
      {selection}
      <rect x={object.x} y={object.y} width={object.width} height={object.height} rx="8" {...svgStyle(object)} />
    </g>
  );
};

const MicrophoneTestBlock = ({
  status,
  result,
  sample,
  levels,
  onTest
}: {
  status: 'idle' | 'testing';
  result: MicrophoneTestResult | null;
  sample: MicrophoneInputSample | null;
  levels: number[];
  onTest: () => void;
}) => {
  const level = sample?.average ?? result?.average ?? 0;
  const peak = sample?.peak ?? result?.peak ?? 0;
  const levelPercent = Math.min(100, Math.max(0, level * 100));
  const bars = normalizeMicBars(levels);

  return (
    <section className={`column-section mic-test-block ${status === 'testing' || result ? 'active' : 'quiet'} ${result ? (result.ok ? 'ok' : 'failed') : ''}`}>
      <div className="panel-heading spaced">
        <div className="section-label">
          <Mic size={17} />
          <h2 className="sr-compatible-title">麦克风输入测试</h2>
        </div>
        <button className="test-cta" type="button" onClick={onTest} disabled={status === 'testing'}>
          <Volume2 size={18} />
          {status === 'testing' ? '采样中' : '测试麦克风'}
        </button>
      </div>
      {status === 'testing' || result ? (
        <div className={`sound-card ${status === 'testing' ? 'testing' : ''}`}>
          <div className="meter-heading">
            <span>{status === 'testing' ? '实时收音' : '测试结果'}</span>
            <b>{`${Math.round(peak * 100)}%`}</b>
          </div>
          <div className="wave-graph" aria-label="麦克风实时音量">
            {bars.map((height, index) => (
              <span key={index} className={levels.length ? 'measured' : ''} style={{ height: `${height}px` }} />
            ))}
          </div>
          <div
            className="sound-slider"
            aria-label={`麦克风平均音量 ${(level * 100).toFixed(1)}%`}
            style={{ background: `linear-gradient(90deg, #0f766e 0 ${levelPercent}%, #e2e8f0 ${levelPercent}% 100%)` }}
          >
            <span style={{ left: `${levelPercent}%` }} />
          </div>
        </div>
      ) : (
        <div className="mic-empty-state">
          <CircleDot size={17} />
          <div>
            <strong>尚未读取麦克风输入</strong>
            <p>点击“测试麦克风”后才会采样真实声音并显示声纹。</p>
          </div>
        </div>
      )}
      <div className="test-result-card">
        {result ? (
          <>
            <p className="result-line">
              <CheckCircle2 size={17} />
              {result.title}
            </p>
            <p>{result.message}</p>
            <p className="result-action">{result.action}</p>
            <div className="level-meter" aria-label={`麦克风峰值 ${(result.peak * 100).toFixed(1)}%`}>
              <span style={{ width: `${Math.min(100, result.peak * 100)}%` }} />
            </div>
          </>
        ) : (
          <p className="result-line muted">
            <CircleDot size={17} />
            {status === 'testing' ? '正在读取真实麦克风输入，请说一句话。' : '尚未测试麦克风输入。'}
          </p>
        )}
      </div>
    </section>
  );
};

const InfoBlock = ({ title, value, tone = 'default' }: { title: string; value: string; tone?: 'default' | 'warning' }) => (
  <section className={`column-section info-block ${tone}`}>
    <h2>{title}</h2>
    <p>{value}</p>
  </section>
);

const ObjectWorkbench = ({
  variant,
  selected,
  scene,
  lastTranscript,
  lastResult,
  aiStatus,
  onCommand
}: {
  variant: 'side' | 'bottom';
  selected?: SceneObject;
  scene: SceneState;
  lastTranscript: string;
  lastResult: ExecutionResult | null;
  aiStatus: AiResolutionStatus;
  onCommand: CommandAction;
}) => {
  const targetObjects = selected ? getSelectedObjectSet(scene, selected) : [];
  const bounds = targetObjects.length ? getObjectBounds(targetObjects) : null;
  const displayName = getSelectionDisplayName(scene, selected);
  const typeLabel = scene.selection?.scope === 'group' && selected?.groupId ? `素材组（${targetObjects.length} 个部件）` : selected ? `${shapeKindLabel(selected.kind)}${selected.partName ? ` · ${selected.partName}` : ''}` : '无';
  const fillSummary = summarizeFill(targetObjects);

  return (
    <section className={`object-workbench ${variant}`} aria-label="当前对象检查器">
      <div className="object-summary">
        <div className="section-label">
          <CircleDot size={17} />
          <h2>当前对象检查器</h2>
        </div>
        <strong>{displayName}</strong>
        <p>{lastResult?.message ?? '选择或创建对象后，这里会显示可编辑属性。'}</p>
        <div className="object-summary-meta">
          <span>对象数 {scene.objects.length}</span>
          <span>{scene.selection?.scope === 'group' ? `当前组 ${targetObjects.length}` : selected?.partName ? `局部 ${selected.partName}` : '单对象'}</span>
          <span>{lastResult ? `${lastResult.latencyMs}ms` : '等待执行'}</span>
        </div>
      </div>

      <div className="object-property-table">
        <ObjectProperty label="对象名称" value={displayName} />
        <ObjectProperty label="图形类型" value={typeLabel} />
        <ObjectProperty label="填充颜色" value={fillSummary.value} swatch={fillSummary.swatch} />
        <ObjectProperty label="描边颜色" value={selected?.style.stroke ?? '无'} swatch={selected?.style.stroke} />
        <ObjectProperty label="位置 x / y" value={bounds ? `${Math.round(bounds.x)} / ${Math.round(bounds.y)}` : '-'} />
        <ObjectProperty label="宽度 / 高度" value={bounds ? `${Math.round(bounds.width)} / ${Math.round(bounds.height)}` : '-'} />
        <ObjectProperty label="素材组" value={selected?.groupName ?? '无'} />
        <ObjectProperty label="局部部件" value={selected?.partName ?? '无'} />
        <ObjectProperty label="最近语音" value={lastTranscript} />
      </div>

      <div className="pipeline object-pipeline" aria-label="语音执行链路">
        <span title="语音文本">语音</span>
        <ArrowRight size={16} />
        <span className="active" title={aiStatus.state === 'used' ? 'DeepSeek 兜底' : '本地规则解析'}>
          {aiStatus.state === 'used' ? 'AI' : '本地'}
        </span>
        <ArrowRight size={16} />
        <span title="JSON schema 校验">校验</span>
        <ArrowRight size={16} />
        <strong title="SVG 画布渲染">渲染</strong>
      </div>

      <div className="capability-toolbar" aria-label="支持的绘图能力">
        <div className="section-label">
          <WandSparkles size={16} />
          <h2>支持的绘图能力</h2>
        </div>
        <div>
          {CAPABILITY_ITEMS.map((item) => (
            <span key={item.label} className={`capability-chip ${item.status}`} title={item.example}>
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="voice-suggestions" aria-label="建议语音">
        {OBJECT_SUGGESTIONS.map((item) => (
          <button key={item} type="button" onClick={() => void onCommand(item)}>
            <CircleDot size={15} />
            {item}
          </button>
        ))}
      </div>
    </section>
  );
};

const ObjectProperty = ({ label, value, swatch }: { label: string; value: string; swatch?: string }) => (
  <div className="object-property-row">
    <span>{label}</span>
    <strong>
      {swatch ? <i style={{ background: swatch }} /> : null}
      {value}
    </strong>
  </div>
);

const getSelectedObjectSet = (scene: SceneState, selected: SceneObject) =>
  scene.selection?.scope === 'group' && selected.groupId
    ? scene.objects.filter((object) => object.groupId === selected.groupId)
    : scene.selection?.scope === 'part' && selected.partId
      ? scene.objects.filter((object) => object.partId === selected.partId)
      : [selected];

const getSelectionDisplayName = (scene: SceneState, selected?: SceneObject) => {
  if (!selected) return '未选择对象';
  if (scene.selection?.scope === 'group') return selected.groupName ?? selected.name;
  return selected.partName ?? selected.name;
};

const getObjectBounds = (objects: SceneObject[]) => {
  const left = Math.min(...objects.map((object) => object.x));
  const top = Math.min(...objects.map((object) => object.y));
  const right = Math.max(...objects.map((object) => object.x + object.width));
  const bottom = Math.max(...objects.map((object) => object.y + object.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
};

const getSvgArtworkPartBounds = (object: SceneObject, partId?: string, partName?: string) => {
  const part = object.svgArtwork?.parts.find((item) => item.id === partId || item.partName === partName);
  if (!part?.bounds) return { x: object.x, y: object.y, width: object.width, height: object.height };
  const [viewX, viewY, viewWidth, viewHeight] = parseArtworkViewBox(object.svgArtwork?.viewBox);
  const scaleX = object.width / viewWidth;
  const scaleY = object.height / viewHeight;
  return {
    x: object.x + (part.bounds.x - viewX) * scaleX,
    y: object.y + (part.bounds.y - viewY) * scaleY,
    width: part.bounds.width * scaleX,
    height: part.bounds.height * scaleY
  };
};

const parseArtworkViewBox = (viewBox?: string): [number, number, number, number] => {
  const parts = viewBox?.trim().split(/\s+/).map(Number) ?? [];
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? [parts[0], parts[1], parts[2], parts[3]] : [0, 0, 960, 600];
};

const safeArtworkViewBox = (viewBox?: string) => parseArtworkViewBox(viewBox).join(' ');

const summarizeFill = (objects: SceneObject[]) => {
  if (!objects.length) return { value: '无', swatch: undefined };
  const fills = [...new Set(objects.map((object) => object.style.fill))];
  return fills.length === 1 ? { value: fills[0], swatch: fills[0] } : { value: `混合（${fills.length} 色）`, swatch: undefined };
};

const StatusRail = ({
  status,
  aiStatus,
  selected,
  selection,
  objectCount,
  lastResult,
  lastTranscript,
  clarification,
  history,
  onCommand
}: {
  status: string;
  aiStatus: AiResolutionStatus;
  selected?: SceneObject;
  selection: SceneState['selection'];
  objectCount: number;
  lastResult: ExecutionResult | null;
  lastTranscript: string;
  clarification: ClarificationState | null;
  history: HistoryItem[];
  onCommand: CommandAction;
}) => (
  <aside className="side-panel status-rail column-card" aria-label="语音状态">
    <AiStatusBlock status={aiStatus} voiceStatus={status} objectCount={objectCount} selected={selected} selection={selection} lastResult={lastResult} />
    <div className="soft-divider" />
    <RailObjectInspector selected={selected} objectCount={objectCount} lastResult={lastResult} />
    <div className="soft-divider" />
    <ExecutionPathBlock aiStatus={aiStatus} lastResult={lastResult} />
    <AiLayoutDiagnosticsBlock diagnostics={lastResult?.layoutDiagnostics} />
    <SvgArtworkDiagnosticsBlock diagnostics={lastResult?.svgArtworkDiagnostics} />
    <div className="soft-divider" />
    <ClarificationFlowBlock clarification={clarification} lastTranscript={lastTranscript} selected={selected} />
    <div className="soft-divider" />
    <CommandGuide onCommand={onCommand} />
    <HistoryTimeline history={history} />
  </aside>
);

const AiStatusBlock = ({
  status,
  voiceStatus,
  objectCount,
  selected,
  selection,
  lastResult
}: {
  status: AiResolutionStatus;
  voiceStatus: string;
  objectCount: number;
  selected?: SceneObject;
  selection: SceneState['selection'];
  lastResult: ExecutionResult | null;
}) => (
  <section className={`ai-status-block ${status.state}`} aria-label="AI 解析状态">
    <div className="ai-row header-row">
      <span>{voiceStatus}</span>
      <strong>{status.state}</strong>
      <b>{status.state === 'used' || status.state === 'local' ? '已处理' : '待处理'}</b>
    </div>
    <div className="ai-row">
      <span>本地规则</span>
      <strong>DeepSeek</strong>
      <b>{status.state === 'used' ? '使用' : '就绪'}</b>
    </div>
    <div className="ai-row">
      <span>intent</span>
      <strong>{status.state === 'used' ? 'DeepSeek-LLM' : 'local-intent'}</strong>
      <b>{selected?.groupName ?? '无'}</b>
    </div>
    <p>{humanAiMessage(status)}</p>
    {status.state === 'checking' ? (
      <div className="ai-generating-banner" role="status" aria-live="polite">
        <Sparkles size={15} />
        <strong>AI 正在生成中</strong>
        <span>请先别继续说；后续语音会排队。</span>
      </div>
    ) : null}
    <dl className="compact-metrics">
      <div>
        <dt>总数</dt>
        <dd>{objectCount}</dd>
      </div>
      <div>
        <dt>选中</dt>
        <dd>{selection?.scope === 'group' ? selected?.groupName ?? selected?.name ?? '无' : selected?.partName ?? selected?.name ?? '无'}</dd>
      </div>
      <div>
        <dt>延迟</dt>
        <dd>{lastResult ? `${lastResult.latencyMs}ms` : '-'}</dd>
      </div>
    </dl>
  </section>
);

const RailObjectInspector = ({
  selected,
  objectCount,
  lastResult
}: {
  selected?: SceneObject;
  objectCount: number;
  lastResult: ExecutionResult | null;
}) => {
  const displayName = selected?.groupName ?? selected?.name ?? '未选择';
  const typeLabel = selected?.groupId ? '素材组' : selected ? shapeKindLabel(selected.kind) : '无';

  return (
    <section className="rail-object-panel" aria-label="当前对象属性">
      <div className="section-label">
        <CircleDot size={17} />
        <h2>当前对象属性</h2>
      </div>
      <dl>
        <div>
          <dt>当前选中对象名称</dt>
          <dd>{displayName}</dd>
        </div>
        <div>
          <dt>图形类型</dt>
          <dd>{typeLabel}</dd>
        </div>
        <div>
          <dt>填充 / 描边</dt>
          <dd>{selected ? `${selected.style.fill} / ${selected.style.stroke}` : '无'}</dd>
        </div>
        <div>
          <dt>位置 / 尺寸</dt>
          <dd>{selected ? `${Math.round(selected.x)},${Math.round(selected.y)} / ${Math.round(selected.width)}x${Math.round(selected.height)}` : '-'}</dd>
        </div>
        <div>
          <dt>画布对象总数</dt>
          <dd>{objectCount}</dd>
        </div>
        <div>
          <dt>最近执行延迟 ms</dt>
          <dd>{lastResult ? lastResult.latencyMs : '-'}</dd>
        </div>
      </dl>
    </section>
  );
};

const ExecutionPathBlock = ({ aiStatus, lastResult }: { aiStatus: AiResolutionStatus; lastResult: ExecutionResult | null }) => {
  const steps = [
    { label: '语音', fullLabel: '语音文本', state: 'done' },
    { label: '本地', fullLabel: '本地规则解析', state: 'done' },
    { label: 'AI', fullLabel: 'DeepSeek 兜底', state: aiStatus.state === 'used' ? 'done' : aiStatus.state === 'checking' ? 'active' : 'skip' },
    { label: 'Schema', fullLabel: 'JSON schema 校验', state: lastResult ? 'done' : 'skip' },
    { label: '布局', fullLabel: '本地语义布局', state: lastResult?.layoutDiagnostics ? 'done' : 'skip' },
    { label: '命令', fullLabel: '白名单绘图命令', state: lastResult ? 'done' : 'skip' },
    { label: 'SVG', fullLabel: 'SVG 画布渲染', state: lastResult?.ok ? 'done' : 'skip' }
  ];
  return (
    <section className="execution-path" aria-label="指令执行链路">
      <div className="section-label">
        <BrainCircuit size={17} />
        <h2>指令执行链路</h2>
      </div>
      <ol>
        {steps.map((step, index) => (
          <li key={step.fullLabel} className={step.state} title={step.fullLabel} aria-label={`${index + 1}. ${step.fullLabel}`}>
            <span>{index + 1}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
};

const AiLayoutDiagnosticsBlock = ({ diagnostics }: { diagnostics?: ExecutionResult['layoutDiagnostics'] }) => {
  if (!diagnostics) return null;
  const visibleParts = diagnostics.parts.slice(0, 5);
  return (
    <section className="ai-layout-diagnostics" aria-label="AI 配方布局">
      <div className="section-label">
        <BrainCircuit size={17} />
        <h2>AI 配方布局</h2>
      </div>
      <dl className="layout-diagnostics-grid">
        <div>
          <dt>Schema</dt>
          <dd>{diagnostics.schemaVersion ?? '已归一化'}</dd>
        </div>
        <div>
          <dt>JSON 摘要</dt>
          <dd>{diagnostics.rawSummary ?? '本地配方'}</dd>
        </div>
        <div>
          <dt>校验</dt>
          <dd>
            {diagnostics.acceptedCount}/{diagnostics.inputCount} 部件
          </dd>
        </div>
        <div>
          <dt>命令</dt>
          <dd>{diagnostics.commandCount}</dd>
        </div>
      </dl>
      <ol className="layout-part-list">
        {visibleParts.map((part) => (
          <li key={`${part.index}-${part.name}`}>
            <span>{part.slot}</span>
            <strong>{part.partName ?? part.name}</strong>
            <small>
              {part.x},{part.y} · {part.width}x{part.height}
            </small>
          </li>
        ))}
      </ol>
      {diagnostics.warnings.length ? <p className="layout-warning">{diagnostics.warnings.slice(0, 2).join('；')}</p> : null}
    </section>
  );
};

const SvgArtworkDiagnosticsBlock = ({ diagnostics }: { diagnostics?: ExecutionResult['svgArtworkDiagnostics'] }) => {
  if (!diagnostics) return null;
  const fallbackReason = diagnostics.fallbackReason ?? '';
  const didNotReceiveSvg =
    diagnostics.sanitizerStatus === 'fallback' &&
    diagnostics.safeMarkupLength === 0 &&
    diagnostics.sanitizedElementCount === 0 &&
    /超时|未配置|没有返回|请求失败|服务返回|结构校验|不可用|base URL|仍在生成|优先使用/i.test(fallbackReason);
  const statusLabel =
    diagnostics.sanitizerStatus === 'accepted'
      ? '已通过'
      : diagnostics.sanitizerStatus === 'fallback'
        ? '已回退'
        : '已拒绝';
  return (
    <section className={`ai-layout-diagnostics svg-artwork-diagnostics ${diagnostics.sanitizerStatus}`} aria-label="SVG 插画安全校验">
      <div className="section-label">
        <ShieldCheck size={17} />
        <h2>SVG 插画安全校验</h2>
      </div>
      <dl className="layout-diagnostics-grid">
        <div>
          <dt>模式</dt>
          <dd>安全 SVG</dd>
        </div>
        <div>
          <dt>结果</dt>
          <dd>{statusLabel}</dd>
        </div>
        <div>
          <dt>元素</dt>
          <dd>{diagnostics.sanitizedElementCount}</dd>
        </div>
        <div>
          <dt>局部</dt>
          <dd>{diagnostics.partCount}</dd>
        </div>
      </dl>
      <div className="svg-diagnostics-copy">
        <p>{diagnostics.fallbackReason ?? diagnostics.qualityNotes ?? 'AI SVG 已清洗后进入画布，导出时只使用安全内容。'}</p>
        <small>
          {didNotReceiveSvg
            ? '未收到可清洗的 SVG，未进入标签清洗统计。'
            : diagnostics.safeMarkupLength === 0 && diagnostics.sanitizerStatus !== 'accepted'
              ? '已收到 SVG，但安全校验拒绝生成可渲染内容。'
            : `丢弃标签 ${diagnostics.droppedElementCount} · 丢弃属性 ${diagnostics.droppedAttributeCount} · 安全字符 ${diagnostics.safeMarkupLength}`}
        </small>
      </div>
      {diagnostics.warnings.length ? <p className="layout-warning">{diagnostics.warnings.slice(0, 2).join('；')}</p> : null}
    </section>
  );
};

const ClarificationFlowBlock = ({
  clarification,
  lastTranscript,
  selected
}: {
  clarification: ClarificationState | null;
  lastTranscript: string;
  selected?: SceneObject;
}) => (
  <section className={`clarification-flow ${clarification ? 'active' : ''}`} aria-label="澄清流程">
    <div className="section-label">
      <HelpCircle size={17} />
      <h2>澄清流程</h2>
    </div>
    <div className="clarification-steps">
      <span>状态：{clarification ? '等待补充' : '无需补充'}</span>
      <ArrowRight size={16} />
      <strong>{clarification?.originalTranscript ?? lastTranscript}</strong>
      <ArrowRight size={16} />
      <span>{clarification?.question ?? selected?.name ?? '目标明确'}</span>
    </div>
  </section>
);

const CommandGuide = ({ onCommand }: { onCommand: CommandAction }) => {
  const [activeTitle, setActiveTitle] = useState(COMMAND_GROUPS[0].title);
  const activeGroup = COMMAND_GROUPS.find((group) => group.title === activeTitle) ?? COMMAND_GROUPS[0];
  return (
    <section className="command-guide command-list" aria-label="可说的指令">
      <div className="command-tabs">
        <h2>指令</h2>
        {COMMAND_GROUPS.map((group) => (
          <button
            key={group.title}
            className={group.title === activeGroup.title ? 'active' : ''}
            type="button"
            title={`查看${group.title}指令`}
            aria-pressed={group.title === activeGroup.title}
            onClick={() => setActiveTitle(group.title)}
          >
            {group.icon}
            <span className="tool-label">{group.title}</span>
          </button>
        ))}
      </div>
      <div className="command-feed">
        <div className="feed-heading">
          <WandSparkles size={15} />
          <span>{activeGroup.title}语音</span>
        </div>
        {activeGroup.items.map((item, index) => (
          <button key={`${item}-${index}`} type="button" onClick={() => void onCommand(item)}>
            <span className={index % 4 === 0 ? 'hot-dot' : ''} />
            <strong>{item}</strong>
            <ChevronDown size={16} />
          </button>
        ))}
      </div>
    </section>
  );
};

const HistoryTimeline = ({ history }: { history: HistoryItem[] }) => {
  const items = history.slice(0, 4);
  return (
    <section className={`history-strip ${items.length ? 'active' : 'empty'}`} aria-label="执行记录">
      <div className="history-heading">
        <Layers3 size={18} />
        <h2>执行记录</h2>
      </div>
      {items.length ? (
        <ol>
          {items.map((item, index) => (
            <li key={`${item.transcript}-${index}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{item.transcript}</strong>
                <p>{item.message}</p>
              </div>
              <b>{item.source}</b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="history-empty-line">运行语音后出现最近 4 条记录。</p>
      )}
    </section>
  );
};

const StatusSummary = ({
  aiStatus,
  diagnostics,
  onOpen
}: {
  aiStatus: AiResolutionStatus;
  diagnostics: SpeechDiagnostics;
  onOpen: () => void;
}) => (
  <section className={`column-section status-summary ${aiStatus.state}`} aria-label="AI 解析状态">
    <div className="panel-heading spaced">
      <div className="section-label">
        <BrainCircuit size={17} />
        <h2>绘图 AI 状态</h2>
      </div>
      <button type="button" className="status-open-button" aria-label="打开状态信息" onClick={onOpen}>
        打开
        <ChevronRight size={16} />
      </button>
    </div>
    <div className="status-summary-grid">
      <span>
        语音
        <strong>{diagnostics.phase}</strong>
      </span>
      <span>
        绘图 AI
        <strong>{aiStatus.state}</strong>
      </span>
    </div>
    <p>{humanAiMessage(aiStatus)}</p>
    {aiStatus.state === 'checking' ? (
      <div className="ai-generating-mini" role="status" aria-live="polite">
        <Sparkles size={14} />
        <span>AI 正在生成中，请先别继续说</span>
      </div>
    ) : null}
    <small>这里显示最近一次绘图指令；设置页的“测试 AI 连接”只验证接口连通性。</small>
  </section>
);

const WorkflowToast = ({ event }: { event: WorkflowEvent }) => (
  <div className={`workflow-toast ${event.tone}`} role="status" aria-live="polite">
    <span className="toast-dot" aria-hidden="true" />
    <div>
      <strong>{event.title}</strong>
      <p>{event.detail}</p>
    </div>
    <time>{event.time}</time>
  </div>
);

const VoiceRuntimeBlock = ({
  runtime,
  pendingConfirmation
}: {
  runtime: VoiceRuntimeSnapshot;
  pendingConfirmation: PendingConfirmationState | null;
}) => {
  const activeCommand = runtime.queue.activeCommand;
  const pendingCommands = runtime.queue.pendingCommands.slice(0, 3);
  return (
    <section className="overlay-section voice-runtime-block" aria-label="语音运行时">
      <div className="section-label">
        <BrainCircuit size={16} />
        <h2>语音运行时</h2>
      </div>
      <dl className="runtime-grid">
        <div>
          <dt>阶段</dt>
          <dd>{runtime.phase}</dd>
        </div>
        <div>
          <dt>当前</dt>
          <dd>{activeCommand?.text ?? '无正在处理指令'}</dd>
        </div>
        <div>
          <dt>队列</dt>
          <dd>{runtime.queue.pendingCount ? `${runtime.queue.pendingCount} 条待执行` : '无排队'}</dd>
        </div>
        <div>
          <dt>朗读</dt>
          <dd>{runtime.speaking ? '语音反馈中' : '未朗读'}</dd>
        </div>
      </dl>
      {pendingConfirmation ? (
        <p className="runtime-warning">{pendingConfirmation.message}</p>
      ) : (
        <p className="runtime-note">{runtime.recentEvent || '等待下一条语音。'}</p>
      )}
      {pendingCommands.length ? (
        <ol className="runtime-queue">
          {pendingCommands.map((command) => (
            <li key={command.commandId}>
              <span>{command.source ?? 'voice'}</span>
              <strong>{command.text}</strong>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
};

const StatusOverlay = ({
  status,
  diagnostics,
  showInterimTranscript,
  generationMode,
  aiStatus,
  selected,
  selection,
  objectCount,
  lastResult,
  lastTranscript,
  clarification,
  voiceRuntime,
  pendingConfirmation,
  history,
  workflowEvents,
  micTestSample,
  micTestLevels,
  onClose,
  onCommand
}: {
  status: string;
  diagnostics: SpeechDiagnostics;
  showInterimTranscript: boolean;
  generationMode: AppSettings['aiGenerationMode'];
  aiStatus: AiResolutionStatus;
  selected?: SceneObject;
  selection: SceneState['selection'];
  objectCount: number;
  lastResult: ExecutionResult | null;
  lastTranscript: string;
  clarification: ClarificationState | null;
  voiceRuntime: VoiceRuntimeSnapshot;
  pendingConfirmation: PendingConfirmationState | null;
  history: HistoryItem[];
  workflowEvents: WorkflowEvent[];
  micTestSample: MicrophoneInputSample | null;
  micTestLevels: number[];
  onClose: () => void;
  onCommand: CommandAction;
}) => {
  const bars = normalizeMicBars(micTestLevels);
  const liveText = (showInterimTranscript ? diagnostics.interimText : null) ?? diagnostics.finalText ?? lastTranscript;
  const transcriptLabel = showInterimTranscript && diagnostics.interimText ? '正在转文字' : diagnostics.finalText ? '最终文本' : '最近文本';

  return (
    <div className="status-overlay-layer" role="presentation">
      <aside className="status-overlay" role="dialog" aria-label="状态信息" aria-modal="false">
        <header className="overlay-header">
          <div>
            <small>环境信息</small>
            <h2>状态信息</h2>
          </div>
          <button type="button" aria-label="关闭状态信息" title="关闭状态信息" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="section-label overlay-status-title">
          <GaugeCircle size={16} />
          <h2>工作流运行状态</h2>
        </div>
        <section className="overlay-metrics" aria-label="工作流运行状态">
          <span>
            语音
            <strong>{voiceStatusLabel(status)}</strong>
          </span>
          <span>
            阶段
            <strong>{diagnostics.phase}</strong>
          </span>
          <span>
            对象
            <strong>{objectCount}</strong>
          </span>
          <span>
            模式
            <strong>{generationMode === 'safe-svg-artwork' ? 'SVG 插画' : '可编辑'}</strong>
          </span>
          <span>
            延迟
            <strong>{lastResult ? `${lastResult.latencyMs}ms` : '-'}</strong>
          </span>
        </section>

        <section className="overlay-section">
          <div className="section-label">
            <Radio size={16} />
            <h2>麦克风与识别</h2>
          </div>
          <div className="overlay-transcript">
            <span>{transcriptLabel}</span>
            <strong>{liveText || '等待语音输入'}</strong>
            <small>{diagnostics.reason ?? '没有新的异常。'}</small>
          </div>
          <div className="overlay-wave" aria-label="状态信息里的麦克风声纹变化">
            {bars.map((height, index) => (
              <span key={index} style={{ height: `${height}px` }} />
            ))}
          </div>
          <p className="overlay-sample">
            峰值 {Math.round((micTestSample?.peak ?? 0) * 100)}% · 平均 {Math.round((micTestSample?.average ?? 0) * 100)}%
          </p>
        </section>

        <VoiceRuntimeBlock runtime={voiceRuntime} pendingConfirmation={pendingConfirmation} />
        <AiStatusBlock status={aiStatus} voiceStatus={status} objectCount={objectCount} selected={selected} selection={selection} lastResult={lastResult} />
        <ExecutionPathBlock aiStatus={aiStatus} lastResult={lastResult} />
        <AiLayoutDiagnosticsBlock diagnostics={lastResult?.layoutDiagnostics} />
        <SvgArtworkDiagnosticsBlock diagnostics={lastResult?.svgArtworkDiagnostics} />
        <ClarificationFlowBlock clarification={clarification} lastTranscript={lastTranscript} selected={selected} />
        <RailObjectInspector selected={selected} objectCount={objectCount} lastResult={lastResult} />

        <section className="overlay-section workflow-events" aria-label="工作流事件">
          <div className="section-label">
            <Layers3 size={16} />
            <h2>运行记录</h2>
          </div>
          {workflowEvents.length ? (
            <ol>
              {workflowEvents.slice(0, 6).map((event) => (
                <li key={event.id} className={event.tone}>
                  <span>{event.time}</span>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>运行语音后，这里会显示识别、AI 解析和执行状态。</p>
          )}
        </section>

        <HistoryTimeline history={history} />
        <div className="overlay-actions">
          <button type="button" onClick={() => void onCommand('画布里有什么')}>查询画布</button>
          <button type="button" onClick={() => void onCommand('当前选中的是什么')}>查询选中</button>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </aside>
    </div>
  );
};

const SettingsWorkspace = ({
  settings,
  activeTab,
  aiConnectionStatus,
  sessionKeyConfigured,
  diagnostics,
  objectCount,
  onTabChange,
  onSettingsChange,
  onSessionKeyChange,
  onClearSessionKey,
  onReset,
  onTestConnection,
  onClose
}: {
  settings: AppSettings;
  activeTab: SettingsTab;
  aiConnectionStatus: AiConnectionStatus;
  sessionKeyConfigured: boolean;
  diagnostics: SpeechDiagnostics;
  objectCount: number;
  onTabChange: (tab: SettingsTab) => void;
  onSettingsChange: (next: AppSettings | ((current: AppSettings) => AppSettings)) => void;
  onSessionKeyChange: (value: string) => void;
  onClearSessionKey: () => void;
  onReset: () => void;
  onTestConnection: () => Promise<string>;
  onClose: () => void;
}) => {
  const sessionInputRef = useRef<HTMLInputElement | null>(null);
  const clearSessionKey = () => {
    if (sessionInputRef.current) sessionInputRef.current.value = '';
    onClearSessionKey();
  };

  return (
  <section className="settings-workspace" aria-label="设置页面">
    <aside className="settings-nav" aria-label="设置分类">
      <div>
        <small>Settings</small>
        <h1>系统设置</h1>
        <p>可说“关闭设置”返回画布。</p>
      </div>
      {SETTINGS_TABS.map((tab) => (
        <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => onTabChange(tab.id)}>
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
      <button type="button" className="settings-close-button" onClick={onClose}>
        <X size={17} />
        返回画布
      </button>
    </aside>

    <section className="settings-panel" aria-label="设置表单">
      {activeTab === 'ai' ? (
        <div className="settings-section-stack">
          <div className="settings-heading">
            <Bot size={20} />
            <div>
              <h2>AI 模型</h2>
              <p>DeepSeek 负责理解复杂自然语言、生成素材配方和局部修改计划。</p>
            </div>
          </div>
          <label className="settings-field">
            <span>Base URL</span>
            <input
              aria-label="AI Base URL"
              value={settings.aiBaseUrl}
              onChange={(event) => onSettingsChange((current) => ({ ...current, aiBaseUrl: event.target.value }))}
            />
            <small>当前代理只允许 https://api.deepseek.com，避免密钥发往未知域名。</small>
          </label>
          <label className="settings-field">
            <span>模型</span>
            <select
              aria-label="AI 模型"
              value={settings.aiModel}
              onChange={(event) => onSettingsChange((current) => ({ ...current, aiModel: event.target.value === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash' }))}
            >
              <option value="deepseek-v4-flash">deepseek-v4-flash</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro</option>
            </select>
          </label>
          <div className="settings-field">
            <span>生图模式</span>
            <div className="settings-segment generation-mode" aria-label="AI 生图模式">
              <button
                type="button"
                className={settings.aiGenerationMode === 'editable-recipe' ? 'active' : ''}
                onClick={() => onSettingsChange((current) => ({ ...current, aiGenerationMode: 'editable-recipe' }))}
              >
                可编辑配方
              </button>
              <button
                type="button"
                className={settings.aiGenerationMode === 'safe-svg-artwork' ? 'active' : ''}
                onClick={() => onSettingsChange((current) => ({ ...current, aiGenerationMode: 'safe-svg-artwork' }))}
              >
                SVG 插画
              </button>
            </div>
            <small>插画模式会先清洗 AI SVG；失败时自动回到可编辑配方。</small>
          </div>
          <label className="settings-field">
            <span>超时 ms</span>
            <input
              aria-label="AI 超时时间"
              type="number"
              min={1500}
              max={60000}
              step={500}
              value={settings.aiTimeoutMs}
              onChange={(event) => onSettingsChange((current) => ({ ...current, aiTimeoutMs: Number(event.target.value) }))}
            />
            <small>连接测试只验证接口可达；复杂 SVG 插画会使用更长生成窗口。</small>
          </label>
          <label className="settings-field">
            <span>API key</span>
            <input
              ref={sessionInputRef}
              aria-label="会话 API Key"
              type="password"
              autoComplete="off"
              placeholder={sessionKeyConfigured ? '本次会话已配置，刷新后失效' : '粘贴后仅保存在当前标签页内存'}
              onChange={(event) => onSessionKeyChange(event.target.value)}
            />
            <small>不会写入 localStorage、执行记录或测试快照。</small>
          </label>
          <div className="settings-actions">
            <button type="button" onClick={() => void onTestConnection()}>
              <BrainCircuit size={17} />
              测试 AI 连接
            </button>
            <button type="button" onClick={clearSessionKey}>清除会话密钥</button>
          </div>
        </div>
      ) : null}

      {activeTab === 'voice' ? (
        <div className="settings-section-stack">
          <div className="settings-heading">
            <Radio size={20} />
            <div>
              <h2>语音控制</h2>
              <p>控制端点等待策略和中间识别文本显示。</p>
            </div>
          </div>
          <div className="settings-segment" aria-label="语音模式设置">
            {(['fast', 'balanced', 'patient'] as EndpointPolicyMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={settings.voicePolicyMode === mode ? 'active' : ''}
                onClick={() => onSettingsChange((current) => ({ ...current, voicePolicyMode: mode }))}
              >
                {mode}
              </button>
            ))}
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.showInterimTranscript}
              onChange={(event) => onSettingsChange((current) => ({ ...current, showInterimTranscript: event.target.checked }))}
            />
            <span>显示中间识别过程</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.aiFallbackEnabled}
              onChange={(event) => onSettingsChange((current) => ({ ...current, aiFallbackEnabled: event.target.checked }))}
            />
            <span>本地规则不确定时请求 AI</span>
          </label>
        </div>
      ) : null}

      {activeTab === 'privacy' ? (
        <div className="settings-section-stack">
          <div className="settings-heading">
            <GaugeCircle size={20} />
            <div>
              <h2>隐私与测试</h2>
              <p>敏感信息仅走同源代理；诊断面板只显示脱敏状态。</p>
            </div>
          </div>
          <div className="settings-note-grid">
            <span>API key 持久化</span>
            <strong>关闭</strong>
            <span>执行记录保存密钥</span>
            <strong>不会</strong>
            <span>当前画布对象</span>
            <strong>{objectCount}</strong>
          </div>
          <button type="button" className="settings-danger-lite" onClick={onReset}>
            重置非敏感设置
          </button>
        </div>
      ) : null}
    </section>

    <aside className={`settings-diagnostics ${aiConnectionStatus.state}`} aria-label="设置诊断">
      <div className="settings-heading compact">
        <BrainCircuit size={18} />
        <div>
          <h2>AI 连接测试</h2>
          <p>{aiConnectionStatus.message}</p>
          <small>这是设置页发起的接口连通性测试；通过不代表复杂 SVG 绘图一定不会超时，画布里的状态记录最近一次真实生成结果。</small>
        </div>
      </div>
      <dl>
        <div>
          <dt>当前模型</dt>
          <dd>{settings.aiModel}</dd>
        </div>
        <div>
          <dt>Base URL</dt>
          <dd>{settings.aiBaseUrl}</dd>
        </div>
        <div>
          <dt>API key</dt>
          <dd>{sessionKeyConfigured ? '本次会话已配置' : '使用服务端环境变量或未配置'}</dd>
        </div>
        <div>
          <dt>生图模式</dt>
          <dd>{settings.aiGenerationMode === 'safe-svg-artwork' ? '安全 SVG 插画' : '可编辑配方'}</dd>
        </div>
        <div>
          <dt>语音阶段</dt>
          <dd>{diagnostics.phase}</dd>
        </div>
        <div>
          <dt>最近测试</dt>
          <dd>{aiConnectionStatus.checkedAt ?? '-'}</dd>
        </div>
      </dl>
      <div className="settings-voice-hints">
        <span>可说</span>
        <strong>打开 AI 设置</strong>
        <strong>把模型改成 deepseek-v4-pro</strong>
        <strong>测试 AI 连接</strong>
        <strong>关闭设置</strong>
      </div>
    </aside>
  </section>
  );
};

const svgStyle = (object: SceneObject) => ({
  fill: object.style.fill,
  stroke: object.style.stroke,
  strokeWidth: object.style.strokeWidth
});

const downloadSvg = (svg: string) => {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `speak2draw-${Date.now()}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const isE2eMode = () => new URLSearchParams(window.location.search).get('e2e') === '1';
const formatClockTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const EMPTY_VOICE_DIAGNOSTICS: SpeechDiagnostics = {
  policyMode: 'balanced',
  phase: 'idle',
  interimText: null,
  finalText: null,
  reason: null,
  updatedAt: 0
};

const CONFIRMATION_TTL_MS = 9000;
const CLARIFICATION_TTL_MS = 18000;
const ECHO_GUARD_MS = 6500;

const normalizeIncomingTranscript = (transcript: VoiceTranscript): VoiceTranscript => {
  const now = performance.now();
  const isFinal = transcript.isFinal !== false;
  return {
    ...transcript,
    text: transcript.text.trim(),
    isFinal,
    source: transcript.source ?? (isFinal ? 'final' : 'interim-fallback'),
    utteranceId: transcript.utteranceId ?? `manual-${Date.now()}`,
    startedAt: transcript.startedAt ?? transcript.receivedAt,
    committedAt: transcript.committedAt ?? now
  };
};

const runtimePhaseFromDiagnostics = (diagnostics: SpeechDiagnostics): VoiceRuntimePhase => {
  switch (diagnostics.phase) {
    case 'permission_requested':
      return 'requesting_permission';
    case 'starting':
    case 'permission_granted':
      return 'starting';
    case 'audio_started':
    case 'sound_started':
    case 'speech_started':
      return 'capturing';
    case 'speech_ended':
    case 'interim_result':
      return 'settling';
    case 'final_result':
    case 'fallback_commit':
      return 'committing';
    case 'restarting':
      return 'restarting';
    case 'error':
    case 'no_speech':
      return 'error';
    case 'speaking':
      return 'speaking';
    case 'listening':
      return 'listening';
    default:
      return 'idle';
  }
};

const requiresVoiceConfirmation = (transcript: VoiceTranscript, commands: DrawingCommand[], scene: SceneState) =>
  isRiskyTranscriptSource(transcript) && commands.some((command) => isRiskyCommand(command, scene));

const isRiskyCommand = (command: DrawingCommand, scene: SceneState) => {
  if (command.type === 'delete_object' || command.type === 'clear_canvas' || command.type === 'undo' || command.type === 'redo') return true;
  if (command.type === 'move_object' || command.type === 'resize_object' || command.type === 'update_object') {
    const targets = findObjects(scene.objects, command.selector, scene.selectedId, scene.selection);
    return targets.length > 1 || Boolean(targets[0]?.groupId);
  }
  return false;
};

const confirmationMessageForCommands = (commands: DrawingCommand[], scene: SceneState) => {
  if (commands.some((command) => command.type === 'clear_canvas')) return '我听到要清空画布。请说“确认”执行，或说“取消”放弃。';
  if (commands.some((command) => command.type === 'undo')) return '我听到要撤销上一步。请说“确认”执行，或说“取消”放弃。';
  if (commands.some((command) => command.type === 'redo')) return '我听到要重做上一步。请说“确认”执行，或说“取消”放弃。';
  const deleteCommand = commands.find((command) => command.type === 'delete_object');
  if (deleteCommand) {
    const target = findObjects(scene.objects, deleteCommand.selector, scene.selectedId, scene.selection)[0];
    return `我听到要删除${target?.partName ?? target?.groupName ?? target?.name ?? '目标图形'}。请说“确认”执行，或说“取消”放弃。`;
  }
  return '这条语音来自中间识别且会修改多个对象。请说“确认”执行，或说“取消”放弃。';
};

const voiceStatusLabel = (status: string) => {
  if (status === 'listening') return '正在监听';
  if (status === 'starting') return '正在启动';
  if (status === 'error') return '需要处理';
  if (status === 'unsupported') return '不支持语音';
  return '未开始';
};

const voiceStatusMessage = (
  status: string,
  error: ReturnType<typeof useSpeechInput>['error'],
  activity: string
) => {
  if (error) return error.title;
  if (status === 'listening') return '正在监听语音';
  if (status === 'starting') return '正在启动语音识别';
  if (status === 'unsupported') return '浏览器不支持语音识别';
  if (status === 'error') return '语音状态需要处理';
  return activity || '未开始监听';
};

const humanAiMessage = (status: AiResolutionStatus) => {
  if (status.state === 'checking') return status.message || AI_GENERATING_NOTICE;
  if (status.state === 'used') return status.message.replace('DeepSeek 已解析为', 'AI 理解为');
  if (status.state === 'fallback') return `AI 暂未接管：${status.message}`;
  if (status.state === 'local') return status.message;
  return status.message;
};

const svgArtworkDiagnosticsMessage = (diagnostics?: SvgArtworkDiagnostics) => {
  if (!diagnostics) return null;
  const reason = diagnostics.fallbackReason ?? '';
  if (/仍在生成|优先使用|较慢|超时/.test(reason)) return 'SVG 插画生成较慢，已优先使用 AI 可编辑配方。';
  return 'SVG 插画校验失败，已使用 AI 可编辑配方模式。';
};

const detectStatusPanelCommand = (text: string): 'open' | 'close' | null => {
  if (/(打开|显示|展开|看看|调出).*(状态信息|状态面板|工作流状态|诊断|环境信息)/.test(text)) return 'open';
  if (/(关闭|收起|隐藏).*(状态信息|状态面板|工作流状态|诊断|环境信息)/.test(text)) return 'close';
  return null;
};

const detectSettingsCommand = (
  text: string
):
  | { type: 'open'; tab: SettingsTab }
  | { type: 'close' }
  | { type: 'model'; model: AppSettings['aiModel'] }
  | { type: 'generation-mode'; mode: AppSettings['aiGenerationMode'] }
  | { type: 'voice-policy'; mode: EndpointPolicyMode }
  | { type: 'test-ai' }
  | null => {
  if (/(关闭|收起|退出|返回).*(设置|配置|设置页|系统设置|AI设置|语音设置|画布)/i.test(text)) return { type: 'close' };
  if (/(测试|检查).*(AI|ai|DeepSeek|deepseek).*(连接|配置|调用)/i.test(text) || /(AI|ai|DeepSeek|deepseek).*(连接测试|测试连接)/i.test(text)) return { type: 'test-ai' };
  if (/deepseek-v4-pro/i.test(text) || /(模型|model).*(pro|高级|强)/i.test(text)) return { type: 'model', model: 'deepseek-v4-pro' };
  if (/deepseek-v4-flash/i.test(text) || /(模型|model).*(flash|快速|快)/i.test(text)) return { type: 'model', model: 'deepseek-v4-flash' };
  if (/(svg|SVG|插画|好看|精美|展示).*(模式|生图|生成)/i.test(text) || /(切换|换|用).*(svg|SVG|插画|好看|精美)/i.test(text)) return { type: 'generation-mode', mode: 'safe-svg-artwork' };
  if (/(可编辑|配方|基础矢量).*(模式|生图|生成)/i.test(text) || /(切换|换|用).*(可编辑|配方|基础矢量)/i.test(text)) return { type: 'generation-mode', mode: 'editable-recipe' };
  if (/(语音|监听).*(fast|快速|快模式)/i.test(text)) return { type: 'voice-policy', mode: 'fast' };
  if (/(语音|监听).*(patient|耐心|慢一点|等久一点)/i.test(text)) return { type: 'voice-policy', mode: 'patient' };
  if (/(语音|监听).*(balanced|平衡|默认)/i.test(text)) return { type: 'voice-policy', mode: 'balanced' };
  if (/(打开|进入|显示|展开|调出).*(AI|ai|DeepSeek|deepseek).*(设置|配置)/i.test(text)) return { type: 'open', tab: 'ai' };
  if (/(打开|进入|显示|展开|调出).*(语音|麦克风|监听).*(设置|配置)/i.test(text)) return { type: 'open', tab: 'voice' };
  if (/(打开|进入|显示|展开|调出).*(隐私|测试).*(设置|配置)/i.test(text)) return { type: 'open', tab: 'privacy' };
  if (/(打开|进入|显示|展开|调出).*(设置|配置|设置页|系统设置)/i.test(text)) return { type: 'open', tab: 'ai' };
  return null;
};

const isCreativeAiCandidate = (text: string, reason?: string) => {
  const wantsCreation = /(画|添加|创建|绘制|生成|来一个|做一个|设计一个)/.test(text);
  if (!wantsCreation) return false;
  if (reason?.includes('没有识别出要画的图形')) return true;
  return !/(圆形|圆|矩形|长方形|正方形|三角形|椭圆|线条|直线|文字|文本|房子|房屋|太阳|树|机器人)/.test(text);
};

const createSvgArtworkCommand = (artwork: SvgArtworkData, transcript: string): DrawingCommand => {
  const bounds = createSvgArtworkObjectBounds();
  const groupId = `svg-artwork-${Date.now()}`;
  return {
    type: 'create_object',
    object: createSceneObject('svg_artwork', {
      id: `${groupId}-object`,
      name: artwork.name || transcript.slice(0, 24) || 'AI SVG 插画',
      groupId,
      groupName: artwork.name || 'AI SVG 插画',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fill: 'none',
      stroke: '#2563eb',
      strokeWidth: 2,
      svgArtwork: artwork
    })
  };
};

const createSvgFallbackDiagnostics = (transcript: string, reason: string): SvgArtworkDiagnostics => ({
  generationMode: 'safe-svg-artwork',
  schemaVersion: 'svg-artwork-1.0',
  transcript,
  sanitizerStatus: 'fallback',
  sanitizedElementCount: 0,
  droppedElementCount: 0,
  droppedAttributeCount: 0,
  partCount: 0,
  safeMarkupLength: 0,
  fallbackReason: reason,
  warnings: [reason]
});

const workflowLabelForDiagnostics = (
  diagnostics: SpeechDiagnostics,
  showInterimTranscript = true
): Pick<WorkflowEvent, 'title' | 'detail' | 'tone'> | null => {
  switch (diagnostics.phase) {
    case 'starting':
    case 'permission_requested':
      return { title: '正在启动监听', detail: '浏览器正在准备麦克风和语音识别。', tone: 'info' };
    case 'permission_granted':
      return { title: '麦克风权限已通过', detail: '等待浏览器进入语音监听。', tone: 'ok' };
    case 'listening':
      return { title: '正在监听语音', detail: '请用普通语速说出绘图指令。', tone: 'info' };
    case 'audio_started':
    case 'sound_started':
    case 'speech_started':
      return { title: '检测到声音', detail: '浏览器正在把声音转换为文字。', tone: 'info' };
    case 'interim_result':
      return { title: '正在转文字', detail: showInterimTranscript ? diagnostics.interimText ?? '已收到中间识别结果。' : '已收到中间识别结果。', tone: 'info' };
    case 'final_result':
      return { title: '语音文本已确认', detail: diagnostics.finalText ?? '已收到最终识别文本。', tone: 'ok' };
    case 'fallback_commit':
      return { title: '按中间文本执行', detail: showInterimTranscript ? diagnostics.interimText ?? '等待最终文本超时，使用已识别内容。' : '等待最终文本超时，使用已识别内容。', tone: 'warning' };
    case 'no_speech':
      return { title: '没有检测到清晰语音', detail: diagnostics.reason ?? '请靠近麦克风再试一次。', tone: 'warning' };
    case 'error':
      return { title: '语音识别异常', detail: diagnostics.reason ?? '请检查麦克风权限和浏览器状态。', tone: 'warning' };
    case 'restarting':
      return { title: '正在重新监听', detail: '上一轮识别已结束，准备继续接收下一句。', tone: 'info' };
    case 'stopped':
      return { title: '监听已停止', detail: '可以再次启动语音监听。', tone: 'info' };
    default:
      return null;
  }
};

const normalizeMicBars = (levels: number[], count = 44) => {
  const baseline = Array.from({ length: count }, (_, index) => 8 + ((index * 7) % 15));
  if (!levels.length) return baseline;

  const recent = levels.slice(-count);
  const padded = recent.length >= count ? recent : [...Array(count - recent.length).fill(0), ...recent];
  return padded.map((level, index) => {
    const shaped = Math.sqrt(Math.max(0, level)) * 150;
    const pulse = (index % 5) * 1.3;
    return Math.min(44, Math.max(7, Math.round(shaped + pulse + 6)));
  });
};

const shapeKindLabel = (kind: SceneObject['kind']) => {
  const labels: Record<SceneObject['kind'], string> = {
    circle: '圆形',
    rectangle: '矩形',
    ellipse: '椭圆',
    line: '线条',
    triangle: '三角形',
    text: '文字',
    svg_artwork: 'AI SVG 插画'
  };
  return labels[kind];
};

const COMMAND_GROUPS = [
  { title: '创建', icon: <WandSparkles size={16} />, primary: true, items: ['画一个红色圆形', '画一个房子和太阳', '画一个蓝色圆形叫月亮'] },
  { title: '编辑', icon: <Palette size={16} />, items: ['把它改成黄色', '填充：黄色', '线条加粗'] },
  { title: '移动', icon: <MoveRight size={16} />, items: ['向右移动一点', '放到中间', '把房子向右移动一点'] },
  { title: '图层', icon: <Layers3 size={16} />, items: ['把房子放到最上层', '把所有图形左对齐'] },
  { title: '排列', icon: <GaugeCircle size={16} />, items: ['水平分布所有图形', '把所有图形成组'] },
  { title: '画布', icon: <Bot size={16} />, items: ['画布里有什么', '清空画布'] },
  { title: '问答', icon: <HelpCircle size={16} />, items: ['我能说什么', '当前选中的是什么'] }
];

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: ReactNode }> = [
  { id: 'ai', label: 'AI 服务', icon: <Bot size={17} /> },
  { id: 'voice', label: '语音控制', icon: <Radio size={17} /> },
  { id: 'privacy', label: '隐私与测试', icon: <GaugeCircle size={17} /> }
];

const CAPABILITY_ITEMS = [
  { label: '创建图形', status: 'ready', example: '示例：画一个红色圆形' },
  { label: '选择对象', status: 'ready', example: '示例：选择最后一个图形' },
  { label: '改色', status: 'ready', example: '示例：把它改成黄色' },
  { label: '修改描边', status: 'ready', example: '示例：线条加粗' },
  { label: '移动', status: 'ready', example: '示例：向右移动一点' },
  { label: '缩放', status: 'ready', example: '示例：放大一点' },
  { label: '置顶', status: 'ready', example: '示例：把太阳放到最上层' },
  { label: '成组', status: 'ready', example: '示例：把所有图形成组' },
  { label: '对齐', status: 'ready', example: '示例：把所有图形左对齐' },
  { label: '均匀分布', status: 'ready', example: '示例：水平分布所有图形' }
];

const OBJECT_SUGGESTIONS = ['导出图片', '撤销', '清空画布', '画布里有什么', '当前选中的是什么', '我能说什么'];

const EMPTY_RECENT_COMMANDS: HistoryItem[] = [
  { transcript: '画一只戴帽子的猫', message: '等待执行', source: '示例', time: '示例' },
  { transcript: '把太阳放到最上层', message: '等待执行', source: '示例', time: '示例' },
  { transcript: '把文字改成世界', message: '等待执行', source: '示例', time: '示例' }
];
