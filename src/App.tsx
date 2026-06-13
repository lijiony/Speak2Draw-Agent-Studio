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
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
  WandSparkles,
  X
} from 'lucide-react';
import { resolveAiIntent, shouldUseAiIntentFallback, type AiRequestOptions } from './ai/aiIntentClient';
import type { AiClarificationContext } from './ai/aiIntentContract';
import { planCommands } from './domain/commandPlanner';
import { executeDrawingCommands } from './domain/drawingExecutor';
import { parseIntent } from './domain/intentParser';
import { createEmptyScene } from './domain/sceneModel';
import type { DrawingIntent, DrawingRecipeItem, ExecutionResult, SceneObject, SceneState, VoiceTranscript } from './domain/types';
import { runMicrophoneInputTest, type MicrophoneInputSample, type MicrophoneTestResult } from './voice/microphoneTest';
import type { EndpointPolicyMode } from './voice/endpointPolicy';
import { useSpeechInput, type SpeechDiagnostics } from './voice/useSpeechInput';
import { speak } from './voice/voiceFeedback';
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

type ClarificationState = AiClarificationContext & {
  waiting: true;
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

declare global {
  interface Window {
    __speak2drawTest?: {
      submitTranscript: (text: string, confidence?: number) => Promise<void>;
      getScene: () => SceneState;
      getAiStatus: () => AiResolutionStatus;
      getClarification: () => ClarificationState | null;
      getVoiceDiagnostics: () => SpeechDiagnostics;
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
    (): AiRequestOptions => ({
      baseUrl: settingsRef.current.aiBaseUrl,
      model: settingsRef.current.aiModel,
      timeoutMs: settingsRef.current.aiTimeoutMs,
      sessionApiKey: sessionApiKeyRef.current || undefined
    }),
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

  const handleTranscript = useCallback(
    async (transcript: VoiceTranscript) => {
      const currentScene = sceneRef.current;
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

        const result: ExecutionResult = {
          ok: !message.includes('失败'),
          message,
          scene: currentScene,
          commandsExecuted: 0,
          latencyMs: Math.max(0, Math.round(performance.now() - transcript.receivedAt))
        };
        setLastTranscript(transcript.text);
        setLastResult(result);
        setHistory((items) => [
          {
            transcript: transcript.text,
            message,
            source: '设置',
            ok: result.ok,
            time: formatClockTime()
          },
          ...items
        ].slice(0, 8));
        pushWorkflowEvent('设置已处理', message, result.ok ? 'ok' : 'warning');
        speak(message);
        return;
      }

      const layoutCommand = detectLayoutCommand(transcript.text);
      if (layoutCommand) {
        const message = workbenchLayoutMessage(layoutCommand);
        const result: ExecutionResult = {
          ok: true,
          message,
          scene: currentScene,
          commandsExecuted: 0,
          latencyMs: Math.max(0, Math.round(performance.now() - transcript.receivedAt))
        };
        setWorkbenchLayout(layoutCommand);
        setLastTranscript(transcript.text);
        setLastResult(result);
        setHistory((items) => [
          {
            transcript: transcript.text,
            message,
            source: '界面布局',
            ok: true,
            time: formatClockTime()
          },
          ...items
        ].slice(0, 8));
        pushWorkflowEvent('布局已切换', message, 'ok');
        speak(message);
        return;
      }

      const panelCommand = detectStatusPanelCommand(transcript.text);
      if (panelCommand) {
        const message = panelCommand === 'open' ? '已打开状态信息。' : '已关闭状态信息。';
        const result: ExecutionResult = {
          ok: true,
          message,
          scene: currentScene,
          commandsExecuted: 0,
          latencyMs: Math.max(0, Math.round(performance.now() - transcript.receivedAt))
        };
        setStatusPanelOpen(panelCommand === 'open');
        setLastTranscript(transcript.text);
        setLastResult(result);
        setHistory((items) => [
          {
            transcript: transcript.text,
            message,
            source: '界面控制',
            ok: true,
            time: formatClockTime()
          },
          ...items
        ].slice(0, 8));
        pushWorkflowEvent(panelCommand === 'open' ? '状态信息已打开' : '状态信息已关闭', transcript.text, 'ok');
        speak(message);
        return;
      }

      const activeClarification = clarificationRef.current;
      const localIntent = parseIntent(transcript);
      let plan = planCommands(localIntent, currentScene);
      let aiHistoryLabel = '本地规则';
      const creativeAiCandidate = isCreativeAiCandidate(transcript.text, localIntent.reason);

      const aiFallbackEnabled = settingsRef.current.aiFallbackEnabled;
      if (aiFallbackEnabled && (activeClarification || shouldUseAiIntentFallback(localIntent, plan, transcript))) {
        pushWorkflowEvent('正在请求 AI', activeClarification ? '结合上一轮澄清继续解析。' : transcript.text, 'info');
        setAiStatus({
          state: 'checking',
          message: activeClarification ? '正在结合上一轮澄清请求 DeepSeek。' : '正在请求 DeepSeek 解析这条语音。'
        });
        const aiResult = await resolveAiIntent(
          transcript,
          currentScene,
          activeClarification ? activeClarification.question : plan.message ?? localIntent.reason,
          activeClarification ?? undefined,
          getAiRequestOptions()
        );
        if (aiResult.ok) {
          plan = planCommands(aiResult.intent, currentScene);
          aiHistoryLabel = 'DeepSeek';
          setAiStatus({
            state: 'used',
            message: `DeepSeek 已解析为 ${aiResult.intent.type}。`
          });
        } else {
          aiHistoryLabel = '本地回退';
          setAiStatus({
            state: 'fallback',
            message: aiResult.reason
          });
          if (creativeAiCandidate) {
            const localCreativeIntent = createLocalCreativeAssetIntent(transcript.text);
            if (localCreativeIntent) {
              plan = planCommands(localCreativeIntent, currentScene);
              aiHistoryLabel = '本地素材配方';
              setAiStatus({
                state: 'fallback',
                message: `DeepSeek 暂不可用，已使用本地安全素材配方：${localCreativeIntent.name ?? '素材'}。`
              });
              pushWorkflowEvent('使用本地素材配方', `AI 暂不可用，已生成 ${localCreativeIntent.name ?? '素材'}。`, 'warning');
            } else {
              plan = {
                commands: [],
                message: `AI 创作服务暂时不可用：${aiResult.reason}`,
                needsClarification: true
              };
            }
          }
        }
      } else {
        setAiStatus({
          state: 'local',
          message: aiFallbackEnabled ? '本地规则已直接处理。' : 'AI 兜底已关闭，本地规则已处理。'
        });
      }

      const result = executeDrawingCommands(currentScene, plan.commands, transcript, plan);
      pushWorkflowEvent(result.ok ? '画布已更新' : '需要补充信息', result.message, result.ok ? 'ok' : 'warning');
      if (result.needsClarification) {
        const nextClarification: ClarificationState = {
          waiting: true,
          originalTranscript: activeClarification?.originalTranscript ?? transcript.text,
          question: result.message,
          reason: plan.message ?? localIntent.reason
        };
        setClarification(nextClarification);
        clarificationRef.current = nextClarification;
      } else {
        setClarification(null);
        clarificationRef.current = null;
      }
      setLastTranscript(transcript.text);
      setScene(result.scene);
      sceneRef.current = result.scene;
      setLastResult(result);
      setHistory((items) => [
        {
          transcript: transcript.text,
          message: result.message,
          source: aiHistoryLabel,
          ok: result.ok,
          time: formatClockTime()
        },
        ...items
      ].slice(0, 8));
      speak(result.message);
      if (result.exportSvg) downloadSvg(result.exportSvg);
    },
    [getAiRequestOptions, pushWorkflowEvent, runAiConnectionTest, setSettings, setVoicePolicyMode]
  );

  useEffect(() => {
    if (!isE2eMode()) return;
    window.__speak2drawTest = {
      submitTranscript: (text: string, confidence = 0.95) =>
        handleTranscript({
          text,
          confidence,
          receivedAt: performance.now(),
          isFinal: true
        }),
      getScene: () => sceneRef.current,
      getAiStatus: () => aiStatusRef.current,
      getClarification: () => clarificationRef.current,
      getVoiceDiagnostics: () => voiceDiagnosticsRef.current ?? EMPTY_VOICE_DIAGNOSTICS,
      getSettings: () => toPublicSettingsSnapshot(settingsRef.current, sessionKeyConfigured),
      getWorkbenchLayout: () => workbenchLayoutRef.current
    };

    return () => {
      delete window.__speak2drawTest;
    };
  }, [handleTranscript, sessionKeyConfigured]);

  const { status, error, activity, diagnostics, start, stop } = useSpeechInput(handleTranscript, { policyMode: voicePolicyMode });
  const selected = useMemo(() => scene.objects.find((object) => object.id === scene.selectedId), [scene.objects, scene.selectedId]);

  useEffect(() => {
    voiceDiagnosticsRef.current = diagnostics;
  }, [diagnostics]);

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
            aiStatus={aiStatus}
            selected={selected}
            selection={scene.selection}
            objectCount={scene.objects.length}
            lastResult={lastResult}
            lastTranscript={lastTranscript}
            clarification={clarification}
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
  const infoColumns = [
    {
      icon: <Radio size={15} />,
      title: '说出想法',
      detail: '从一句中文语音开始，不需要鼠标或键盘。',
      what: '浏览器麦克风持续收音，把用户说的完整句子整理成可解析文本，例如“画一个戴帽子的小猫”。',
      why: '纯语音绘图最怕半句话就执行。系统会等待最终识别结果，并把未听清、低置信度和超时状态单独反馈。',
      proof: '已实现麦克风测试、收音波形、端点策略、无清晰语音提示和语音状态浮层。',
      example: '试试说：画一个红色圆形。'
    },
    {
      icon: <BrainCircuit size={15} />,
      title: '理解意图',
      detail: '本地规则先判断，复杂或模糊请求再交给 AI。',
      what: '系统会把语音文本识别为创建、选择、修改、删除、查询、撤销或导出等绘图意图。',
      why: '把听到的话和真正要做的事分开，能减少“听见了但做错了”的风险。',
      proof: 'AI 只返回受控 JSON 指令，不直接改画布；设置页可测试连接，也能关闭 AI 兜底。',
      example: '试试说：把帽子删掉，不好看。'
    },
    {
      icon: <Layers3 size={15} />,
      title: '拆解步骤',
      detail: '把复杂创作拆成可回放、可撤销的绘图命令。',
      what: '复杂对象会拆成素材组和局部部件，例如小猫包含脸、耳朵、眼睛、帽子。',
      why: '用户后续要改局部时，系统能知道“帽子”和“整只小猫”的区别。',
      proof: '已支持素材组选择、局部选择、删除帽子不删除小猫、复杂指令批量执行。',
      example: '试试说：选择房子的窗户。'
    },
    {
      icon: <CheckCircle2 size={15} />,
      title: '执行反馈',
      detail: '画布更新、历史记录和状态解释同步出现。',
      what: '绘图命令会更新 SVG 场景模型，并记录执行结果、失败原因、撤销栈和语音反馈。',
      why: '用户看不到底层操作，所以每一步都要告诉用户系统理解了什么、执行了什么。',
      proof: '已实现撤销重做、清空导出、状态信息浮层、AI 状态说明和延迟指标。',
      example: '试试说：打开状态信息。'
    }
  ];
  const visibleFlowIndex = previewOpen ? (pinnedFlowIndex ?? activeFlowIndex) : null;
  const visibleFlow = visibleFlowIndex === null ? null : infoColumns[visibleFlowIndex];
  const keywordRows = [
    ['语音端点检测', '中文意图解析', '低置信度澄清', '复杂指令拆解', 'AI 安全兜底', '局部对象编辑', 'SVG 实时渲染', '撤销重做记录'],
    ['戴帽子的小猫', '删除帽子', '选择房子窗户', '打开状态信息', '测试 AI 连接', '导出 SVG', '清空画布', '恢复画布模式']
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
        <button className="landing-primary-button" type="button" onClick={onEnter}>
          <span>Speak2Draw-Agent-Studio</span>
          <strong>
            <span className="landing-enter-label">进入工作台</span>
            <ArrowRight size={16} />
          </strong>
        </button>
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
      <div className="floating-mic" aria-hidden="true">
        <Mic size={25} />
      </div>
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
    scene.selection?.scope === 'part' && selectedObject?.partId ? scene.objects.filter((object) => object.partId === selectedObject.partId) : [];
  const selectedPartBounds = selectedPartObjects.length > 1 ? getObjectBounds(selectedPartObjects) : null;

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
      {selectedPartBounds ? <PartSelectionBox bounds={selectedPartBounds} label={selectedObject?.partName ?? selectedObject?.name ?? '局部'} /> : null}
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
        <span>语音文本</span>
        <ArrowRight size={16} />
        <span className="active">{aiStatus.state === 'used' ? 'DeepSeek 兜底' : '本地规则解析'}</span>
        <ArrowRight size={16} />
        <span>JSON schema 校验</span>
        <ArrowRight size={16} />
        <strong>SVG 画布渲染</strong>
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
    { label: '语音文本', state: 'done' },
    { label: '本地规则解析', state: 'done' },
    { label: 'DeepSeek 兜底', state: aiStatus.state === 'used' ? 'done' : aiStatus.state === 'checking' ? 'active' : 'skip' },
    { label: 'JSON schema 校验', state: lastResult ? 'done' : 'skip' },
    { label: '白名单绘图命令', state: lastResult ? 'done' : 'skip' },
    { label: 'SVG 画布渲染', state: lastResult?.ok ? 'done' : 'skip' }
  ];
  return (
    <section className="execution-path" aria-label="指令执行链路">
      <div className="section-label">
        <BrainCircuit size={17} />
        <h2>指令执行链路</h2>
      </div>
      <ol>
        {steps.map((step, index) => (
          <li key={step.label} className={step.state}>
            <span>{index + 1}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
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

const StatusOverlay = ({
  status,
  diagnostics,
  showInterimTranscript,
  aiStatus,
  selected,
  selection,
  objectCount,
  lastResult,
  lastTranscript,
  clarification,
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
  aiStatus: AiResolutionStatus;
  selected?: SceneObject;
  selection: SceneState['selection'];
  objectCount: number;
  lastResult: ExecutionResult | null;
  lastTranscript: string;
  clarification: ClarificationState | null;
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

        <AiStatusBlock status={aiStatus} voiceStatus={status} objectCount={objectCount} selected={selected} selection={selection} lastResult={lastResult} />
        <ExecutionPathBlock aiStatus={aiStatus} lastResult={lastResult} />
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
          <label className="settings-field">
            <span>超时 ms</span>
            <input
              aria-label="AI 超时时间"
              type="number"
              min={1500}
              max={15000}
              step={500}
              value={settings.aiTimeoutMs}
              onChange={(event) => onSettingsChange((current) => ({ ...current, aiTimeoutMs: Number(event.target.value) }))}
            />
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
          <small>这是设置页发起的接口连通性测试；画布里的“绘图 AI 状态”只记录最近一次语音绘图是否使用 AI 解析。</small>
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
  if (status.state === 'checking') return '正在理解这句话。';
  if (status.state === 'used') return status.message.replace('DeepSeek 已解析为', 'AI 理解为');
  if (status.state === 'fallback') return `AI 暂未接管：${status.message}`;
  if (status.state === 'local') return status.message;
  return status.message;
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
  | { type: 'voice-policy'; mode: EndpointPolicyMode }
  | { type: 'test-ai' }
  | null => {
  if (/(关闭|收起|退出|返回).*(设置|配置|设置页|系统设置|AI设置|语音设置|画布)/i.test(text)) return { type: 'close' };
  if (/(测试|检查).*(AI|ai|DeepSeek|deepseek).*(连接|配置|调用)/i.test(text) || /(AI|ai|DeepSeek|deepseek).*(连接测试|测试连接)/i.test(text)) return { type: 'test-ai' };
  if (/deepseek-v4-pro/i.test(text) || /(模型|model).*(pro|高级|强)/i.test(text)) return { type: 'model', model: 'deepseek-v4-pro' };
  if (/deepseek-v4-flash/i.test(text) || /(模型|model).*(flash|快速|快)/i.test(text)) return { type: 'model', model: 'deepseek-v4-flash' };
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

const createLocalCreativeAssetIntent = (text: string): DrawingIntent | null => {
  if (/(猫|小猫|小花猫|戴帽子的猫|戴帽子的小猫)/.test(text)) {
    const withHat = /(帽子|戴帽|红帽|礼帽)/.test(text);
    const recipe: DrawingRecipeItem[] = [
      { shape: 'circle', name: '小猫脸', partName: '脸', color: '#f8fafc', strokeColor: '#111827', strokeWidth: 4, position: { x: 370, y: 228 }, width: 158, height: 136 },
      { shape: 'triangle', name: '小猫左耳', partName: '耳朵', color: '#f8fafc', strokeColor: '#111827', strokeWidth: 4, position: { x: 376, y: 188 }, width: 58, height: 70 },
      { shape: 'triangle', name: '小猫右耳', partName: '耳朵', color: '#f8fafc', strokeColor: '#111827', strokeWidth: 4, position: { x: 465, y: 188 }, width: 58, height: 70 },
      { shape: 'circle', name: '小猫左眼', partName: '眼睛', color: '#111827', strokeColor: '#111827', strokeWidth: 2, position: { x: 416, y: 274 }, width: 18, height: 18 },
      { shape: 'circle', name: '小猫右眼', partName: '眼睛', color: '#111827', strokeColor: '#111827', strokeWidth: 2, position: { x: 462, y: 274 }, width: 18, height: 18 },
      { shape: 'triangle', name: '小猫鼻子', partName: '鼻子', color: '#ec4899', strokeColor: '#111827', strokeWidth: 2, position: { x: 438, y: 300 }, width: 22, height: 18 }
    ];
    if (withHat) {
      recipe.push(
        { shape: 'rectangle', name: '小猫帽檐', partName: '帽子', color: '#ef4444', strokeColor: '#111827', strokeWidth: 3, position: { x: 393, y: 204 }, width: 112, height: 26 },
        { shape: 'rectangle', name: '小猫帽子', partName: '帽子', color: '#ef4444', strokeColor: '#111827', strokeWidth: 3, position: { x: 418, y: 164 }, width: 64, height: 48 }
      );
    }
    return {
      type: 'create_asset_recipe',
      rawText: text,
      name: withHat ? '戴帽子的小猫' : '小猫',
      recipe
    };
  }

  return null;
};

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
    text: '文字'
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
