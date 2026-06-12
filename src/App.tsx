import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Palette,
  Radio,
  Redo2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
  WandSparkles,
  X
} from 'lucide-react';
import { resolveAiIntent, shouldUseAiIntentFallback } from './ai/aiIntentClient';
import type { AiClarificationContext } from './ai/aiIntentContract';
import { planCommands } from './domain/commandPlanner';
import { executeDrawingCommands } from './domain/drawingExecutor';
import { parseIntent } from './domain/intentParser';
import { createEmptyScene } from './domain/sceneModel';
import type { ExecutionResult, SceneObject, SceneState, VoiceTranscript } from './domain/types';
import { runMicrophoneInputTest, type MicrophoneTestResult } from './voice/microphoneTest';
import type { EndpointPolicyMode } from './voice/endpointPolicy';
import { useSpeechInput, type SpeechDiagnostics } from './voice/useSpeechInput';
import { speak } from './voice/voiceFeedback';

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
};

type CommandAction = (text: string) => Promise<void>;

declare global {
  interface Window {
    __speak2drawTest?: {
      submitTranscript: (text: string, confidence?: number) => Promise<void>;
      getScene: () => SceneState;
      getAiStatus: () => AiResolutionStatus;
      getClarification: () => ClarificationState | null;
      getVoiceDiagnostics: () => SpeechDiagnostics;
    };
  }
}

export const App = () => {
  const [scene, setScene] = useState<SceneState>(() => createEmptyScene());
  const sceneRef = useRef(scene);
  const [lastTranscript, setLastTranscript] = useState('等待语音指令');
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [micTestStatus, setMicTestStatus] = useState<'idle' | 'testing'>('idle');
  const [micTestResult, setMicTestResult] = useState<MicrophoneTestResult | null>(null);
  const [aiStatus, setAiStatus] = useState<AiResolutionStatus>(() => ({
    state: 'idle',
    message: '等待需要 AI 协助的语音指令。'
  }));
  const aiStatusRef = useRef(aiStatus);
  const [clarification, setClarification] = useState<ClarificationState | null>(null);
  const clarificationRef = useRef<ClarificationState | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const voiceDiagnosticsRef = useRef<SpeechDiagnostics | null>(null);
  const voicePolicyMode = useMemo(() => getVoicePolicyMode(), []);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    aiStatusRef.current = aiStatus;
  }, [aiStatus]);

  useEffect(() => {
    clarificationRef.current = clarification;
  }, [clarification]);

  const handleTranscript = useCallback(
    async (transcript: VoiceTranscript) => {
      const currentScene = sceneRef.current;
      const activeClarification = clarificationRef.current;
      const localIntent = parseIntent(transcript);
      let plan = planCommands(localIntent, currentScene);
      let aiHistoryLabel = '本地规则';

      if (activeClarification || shouldUseAiIntentFallback(localIntent, plan, transcript)) {
        setAiStatus({
          state: 'checking',
          message: activeClarification ? '正在结合上一轮澄清请求 DeepSeek。' : '正在请求 DeepSeek 解析这条语音。'
        });
        const aiResult = await resolveAiIntent(
          transcript,
          currentScene,
          activeClarification ? activeClarification.question : plan.message ?? localIntent.reason,
          activeClarification ?? undefined
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
        }
      } else {
        setAiStatus({
          state: 'local',
          message: '本地规则已直接处理。'
        });
      }

      const result = executeDrawingCommands(currentScene, plan.commands, transcript, plan);
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
          source: aiHistoryLabel
        },
        ...items
      ].slice(0, 8));
      speak(result.message);
      if (result.exportSvg) downloadSvg(result.exportSvg);
    },
    []
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
      getVoiceDiagnostics: () => voiceDiagnosticsRef.current ?? EMPTY_VOICE_DIAGNOSTICS
    };

    return () => {
      delete window.__speak2drawTest;
    };
  }, [handleTranscript]);

  const { status, error, activity, diagnostics, start, stop } = useSpeechInput(handleTranscript, { policyMode: voicePolicyMode });
  const selected = useMemo(() => scene.objects.find((object) => object.id === scene.selectedId), [scene.objects, scene.selectedId]);

  useEffect(() => {
    voiceDiagnosticsRef.current = diagnostics;
  }, [diagnostics]);

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
    const result = await runMicrophoneInputTest();
    setMicTestResult(result);
    setMicTestStatus('idle');
  }, [status, stop]);

  return (
    <main className="app-shell">
      <section className="studio-shell" aria-label="语音绘图工作台">
        <VoiceTopDeck
          status={status}
          error={error}
          activity={activity}
          diagnostics={diagnostics}
          lastTranscript={lastTranscript}
          lastResult={lastResult}
          voicePolicyMode={voicePolicyMode}
          start={start}
          stop={stop}
        />

        <div className="studio-console">
          <DiagnosticsColumn
            status={status}
            error={error}
            activity={activity}
            clarification={clarification}
            lastResult={lastResult}
            micTestStatus={micTestStatus}
            micTestResult={micTestResult}
            onMicrophoneTest={handleMicrophoneTest}
            onCommand={submitStudioCommand}
          />

          <div className="studio-main">
            <CanvasStage scene={scene} selected={selected} />
            <ObjectWorkbench selected={selected} scene={scene} lastTranscript={lastTranscript} lastResult={lastResult} aiStatus={aiStatus} onCommand={submitStudioCommand} />
          </div>

          <StatusRail
            status={status}
            aiStatus={aiStatus}
            selected={selected}
            objectCount={scene.objects.length}
            lastResult={lastResult}
            history={history}
            onCommand={submitStudioCommand}
          />
        </div>
      </section>
    </main>
  );
};

const VoiceTopDeck = ({
  status,
  error,
  activity,
  diagnostics,
  lastTranscript,
  lastResult,
  voicePolicyMode,
  start,
  stop
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  diagnostics: SpeechDiagnostics;
  lastTranscript: string;
  lastResult: ExecutionResult | null;
  voicePolicyMode: EndpointPolicyMode;
  start: () => void;
  stop: () => void;
}) => {
  const listening = status === 'listening';
  const stageText = diagnostics.interimText ?? diagnostics.finalText ?? (activity || lastResult?.message || '检测到停顿');

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
        className={`mic-control ${listening ? 'active' : ''}`}
        onClick={listening ? stop : start}
        disabled={status === 'unsupported' || status === 'starting'}
        title={listening ? '停止语音监听' : '启动语音监听'}
        aria-label={listening ? '停止语音监听' : '启动语音监听'}
      >
        {listening ? <MicOff size={24} /> : <Mic size={24} />}
      </button>
      <div className="top-state">
        <strong>{voiceStatusLabel(status)}</strong>
        <ChevronDown size={17} />
      </div>

      <div className="control-strip">
        <div className="status-select">
          <Radio size={17} />
          <span>{error?.title ?? (listening ? '正在监听...' : '未开始监听')}</span>
          <ChevronDown size={17} />
        </div>
        <button className="policy-pill" type="button" title="端点策略">
          <span>{voicePolicyMode === 'balanced' ? 'fast' : voicePolicyMode}</span>
          <ChevronDown size={17} />
        </button>
        <div className="transcript-command" title={lastTranscript}>
          <span>{stageText}</span>
          <ChevronRight size={20} />
        </div>
        <button className="mode-pill primary" type="button" title="本地与 AI 平衡模式">
          <Bot size={18} />
          <span>balanced</span>
        </button>
        <button className="mode-pill" type="button" title="耐心监听模式">
          <GaugeCircle size={18} />
          <span>patient</span>
          <ChevronDown size={17} />
        </button>
      </div>
    </header>
  );
};

const DiagnosticsColumn = ({
  status,
  error,
  activity,
  clarification,
  lastResult,
  micTestStatus,
  micTestResult,
  onMicrophoneTest,
  onCommand
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  clarification: ClarificationState | null;
  lastResult: ExecutionResult | null;
  micTestStatus: 'idle' | 'testing';
  micTestResult: MicrophoneTestResult | null;
  onMicrophoneTest: () => void;
  onCommand: CommandAction;
}) => (
  <aside className="diagnostics-column" aria-label="麦克风诊断">
    <section className="panel mic-script-card">
      <div className="panel-heading spaced">
        <h2>测试麦克风</h2>
        <span className={`tiny-state ${status}`}>{voiceStatusLabel(status)}</span>
      </div>
      <div className="script-buttons" aria-label="语音样例">
        <button type="button" onClick={() => void onCommand('画一个黄色太阳')}>画太阳</button>
        <button type="button" onClick={() => void onCommand('把房子向右移动一点')}>移动房子</button>
      </div>
      <p className="subtle-line">{activity || error?.message || '满句聚相，等待清晰语音。'}</p>
    </section>

    <MicrophoneTestBlock status={micTestStatus} result={micTestResult} onTest={onMicrophoneTest} />
    {clarification ? <InfoBlock title="等待补充" value={clarification.question} tone="warning" /> : null}
    <InfoBlock title="系统反馈" value={lastResult?.message ?? '启动监听后，说出绘图指令。'} tone={lastResult?.ok === false ? 'warning' : 'default'} />
    <ActionDock onCommand={onCommand} />
  </aside>
);

const ActionDock = ({ onCommand }: { onCommand: CommandAction }) => (
  <section className="panel action-dock" aria-label="快捷操作">
    <div className="action-row">
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
    </div>
    <div className="action-row secondary">
      <button type="button" onClick={() => void onCommand('导出图片')}>
        <Download size={18} />
        导出SVG
      </button>
      <button type="button" onClick={() => void onCommand('我能说什么')}>
        <HelpCircle size={18} />
        帮助
      </button>
    </div>
  </section>
);

const CanvasStage = ({ scene, selected }: { scene: SceneState; selected?: SceneObject }) => (
  <section className="canvas-stage canvas-panel" aria-label="绘图画布">
    <div className="canvas-titlebar">
      <span>960x600</span>
      <button type="button" aria-label="收起画布提示" title="收起画布提示">
        <X size={18} />
      </button>
    </div>
    <div className="canvas-surface">
      <div className="axis-y" aria-hidden="true">
        {[16, 70, 15, 10, 19, 13, 7, 1, 0].map((item, index) => (
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
      <DrawingCanvas scene={scene} />
      {scene.objects.length === 0 ? (
        <div className="empty-canvas-hint">
          <Sparkles size={18} />
          <strong>试试说：画一个红色圆形</strong>
        </div>
      ) : null}
      <div className="axis-x" aria-hidden="true">
        {[0, 1, 2, 3, 5, 10, 13, 15, 16, 7, 7, 18, 9, 19].map((item, index) => (
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    </div>
    <div className="canvas-floating-badges" aria-hidden="true">
      <span>{selected?.name ?? '未选中'}</span>
      <span>SVG</span>
    </div>
  </section>
);

const DrawingCanvas = ({ scene }: { scene: SceneState }) => (
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
    {scene.objects.map((object) => {
      const selectedObject = scene.objects.find((item) => item.id === scene.selectedId);
      const selected = object.id === scene.selectedId || Boolean(selectedObject?.groupId && selectedObject.groupId === object.groupId);
      return <SceneObjectView key={object.id} object={object} selected={selected} />;
    })}
  </svg>
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
  onTest
}: {
  status: 'idle' | 'testing';
  result: MicrophoneTestResult | null;
  onTest: () => void;
}) => (
  <section className={`panel mic-test-block ${result ? (result.ok ? 'ok' : 'failed') : ''}`}>
    <h2 className="sr-compatible-title">麦克风输入测试</h2>
    <button className="test-cta" type="button" onClick={onTest} disabled={status === 'testing'}>
      <Volume2 size={18} />
      {status === 'testing' ? '测试中...' : '测试麦克风'}
    </button>
    <div className={`sound-card ${status === 'testing' ? 'testing' : ''}`}>
      <div className="wave-graph" aria-hidden="true">
        {Array.from({ length: 44 }, (_, index) => (
          <span key={index} style={{ height: `${10 + Math.sin(index * 0.75) * 20 + (index % 5) * 3}px` }} />
        ))}
      </div>
      <div className="sound-slider">
        <span />
      </div>
    </div>
    <div className="test-result-card">
      <h2>测试结果</h2>
      {result ? (
        <>
          <p className="result-line">
            <CheckCircle2 size={17} />
            {result.title}
          </p>
          <p>{result.message}</p>
          <div className="level-meter" aria-label={`麦克风峰值 ${(result.peak * 100).toFixed(1)}%`}>
            <span style={{ width: `${Math.min(100, result.peak * 100)}%` }} />
          </div>
        </>
      ) : (
        <p className="result-line muted">
          <CircleDot size={17} />
          麦克风正常，可以使用
        </p>
      )}
    </div>
  </section>
);

const InfoBlock = ({ title, value, tone = 'default' }: { title: string; value: string; tone?: 'default' | 'warning' }) => (
  <section className={`panel info-block ${tone}`}>
    <h2>{title}</h2>
    <p>{value}</p>
  </section>
);

const ObjectWorkbench = ({
  selected,
  scene,
  lastTranscript,
  lastResult,
  aiStatus,
  onCommand
}: {
  selected?: SceneObject;
  scene: SceneState;
  lastTranscript: string;
  lastResult: ExecutionResult | null;
  aiStatus: AiResolutionStatus;
  onCommand: CommandAction;
}) => (
  <section className="object-workbench" aria-label="当前对象检查器">
    <div className="object-head">
      <h2>当前对象检查器</h2>
      <div className="pipeline" aria-label="语音执行链路">
        <span>语音文本</span>
        <ArrowRight size={18} />
        <span className="active">本地规则解析</span>
        <ArrowRight size={18} />
        <span className="active">{lastTranscript === '等待语音指令' ? '把文字改成世界' : lastTranscript}</span>
        <ArrowRight size={18} />
        <span>描边</span>
        <strong>{selected?.style.stroke ?? '无'}</strong>
      </div>
      <p>
        清清：
        <strong>{lastTranscript}</strong>
        <ArrowRight size={16} />
        <span>{aiStatus.state === 'used' ? 'DeepSeek兜底' : '本地规则'}</span>
        <ArrowRight size={16} />
        <span>JSON schema校验</span>
        <ArrowRight size={16} />
        <span>SVG画布渲染</span>
      </p>
    </div>

    <div className="object-details">
      <ObjectFact color={selected?.style.fill ?? '#facc15'} label="名称" value={selected?.name ?? '未选择'} />
      <ObjectFact color="#f59e0b" label="类型" value={selected ? shapeKindLabel(selected.kind) : '无'} />
      <ObjectFact color="#a855f7" label="素材组" value={selected?.groupName ?? '无'} />
      <ObjectFact color="#22c55e" label="总数" value={`${scene.objects.length}`} />
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

const ObjectFact = ({ color, label, value }: { color: string; label: string; value: string }) => (
  <div className="object-fact">
    <span style={{ background: color }} />
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  </div>
);

const StatusRail = ({
  status,
  aiStatus,
  selected,
  objectCount,
  lastResult,
  history,
  onCommand
}: {
  status: string;
  aiStatus: AiResolutionStatus;
  selected?: SceneObject;
  objectCount: number;
  lastResult: ExecutionResult | null;
  history: HistoryItem[];
  onCommand: CommandAction;
}) => (
  <aside className="side-panel status-rail" aria-label="语音状态">
    <AiStatusBlock status={aiStatus} voiceStatus={status} objectCount={objectCount} selected={selected} lastResult={lastResult} />
    <div className="right-command-shell">
      <CommandGuide onCommand={onCommand} />
      <HistoryTimeline history={history} />
    </div>
  </aside>
);

const AiStatusBlock = ({
  status,
  voiceStatus,
  objectCount,
  selected,
  lastResult
}: {
  status: AiResolutionStatus;
  voiceStatus: string;
  objectCount: number;
  selected?: SceneObject;
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
        <dd>{selected?.name ?? '无'}</dd>
      </div>
      <div>
        <dt>延迟</dt>
        <dd>{lastResult ? `${lastResult.latencyMs}ms` : '-'}</dd>
      </div>
    </dl>
  </section>
);

const CommandGuide = ({ onCommand }: { onCommand: CommandAction }) => (
  <section className="command-guide command-list" aria-label="可说的指令">
    <div className="command-tabs">
      <h2>AI复杂素材</h2>
      {COMMAND_GROUPS.map((group) => (
        <button key={group.title} className={group.primary ? 'active' : ''} type="button" onClick={() => void onCommand(group.items[0])}>
          {group.icon}
          {group.title}
        </button>
      ))}
    </div>
    <div className="command-feed">
      {COMMAND_GROUPS.flatMap((group) => group.items.slice(0, group.primary ? 5 : 2)).map((item, index) => (
        <button key={`${item}-${index}`} type="button" onClick={() => void onCommand(item)}>
          <span className={index % 3 === 0 ? 'hot-dot' : ''} />
          <strong>{item}</strong>
          <ChevronDown size={16} />
        </button>
      ))}
    </div>
  </section>
);

const HistoryTimeline = ({ history }: { history: HistoryItem[] }) => {
  const items = history.length ? history : EMPTY_HISTORY;
  return (
    <section className="history-strip" aria-label="执行记录">
      <div className="history-heading">
        <Layers3 size={18} />
        <h2>执行记录</h2>
      </div>
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
const getVoicePolicyMode = (): EndpointPolicyMode => {
  const mode = new URLSearchParams(window.location.search).get('voicePolicy');
  return mode === 'fast' || mode === 'patient' || mode === 'balanced' ? mode : 'balanced';
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

const humanAiMessage = (status: AiResolutionStatus) => {
  if (status.state === 'checking') return '正在理解这句话。';
  if (status.state === 'used') return status.message.replace('DeepSeek 已解析为', 'AI 理解为');
  if (status.state === 'fallback') return `AI 暂未接管：${status.message}`;
  if (status.state === 'local') return '本地规则已直接处理。';
  return status.message;
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
  { title: '创建', icon: <WandSparkles size={16} />, primary: true, items: ['画一个红色圆形', '把太阳放到最上层', '位置：x:100,y:100', '高度：50', '总数：7'] },
  { title: '编辑', icon: <Palette size={16} />, items: ['把它改成黄色', '填充：黄色', '修改文字为你好'] },
  { title: '移动', icon: <MoveRight size={16} />, items: ['向右移动一点', '放到中间', '把房子向右移动一点'] },
  { title: '图层', icon: <Layers3 size={16} />, items: ['把房子放到最上层', '把所有图形左对齐'] },
  { title: '排列', icon: <GaugeCircle size={16} />, items: ['水平分布所有图形', '把所有图形成组'] },
  { title: '画布', icon: <Bot size={16} />, items: ['画布里有什么', '清空画布'] },
  { title: '问答', icon: <HelpCircle size={16} />, items: ['我能说什么', '当前选中的是什么'] }
];

const OBJECT_SUGGESTIONS = ['导出图片', '撤销', '清空画布', '画布里有什么', '当前选中的是什么', '我在说什么'];

const EMPTY_HISTORY: HistoryItem[] = [
  { transcript: '画一个红色圆形', message: '等待语音执行。', source: '未执行' },
  { transcript: '写文字你好', message: '等待语音执行。', source: '未执行' },
  { transcript: '把它改成黄色', message: '等待语音执行。', source: '未执行' }
];
