import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, BrainCircuit, Mic, MicOff, MousePointer2, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
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
      <section className="workspace" aria-label="语音绘图工作台">
        <VoiceCommandBar
          status={status}
          error={error}
          activity={activity}
          lastTranscript={lastTranscript}
          lastResult={lastResult}
          start={start}
          stop={stop}
        />

        <div className="workbench-grid">
          <CanvasStage scene={scene} selected={selected} />

          <StatusRail
            status={status}
            error={error}
            activity={activity}
            aiStatus={aiStatus}
            clarification={clarification}
            selected={selected}
            objectCount={scene.objects.length}
            lastTranscript={lastTranscript}
            lastResult={lastResult}
            micTestStatus={micTestStatus}
            micTestResult={micTestResult}
            onMicrophoneTest={handleMicrophoneTest}
          />
        </div>

        <div className="lower-grid">
          <CommandGuide />
          <HistoryTimeline history={history} />
        </div>
      </section>
    </main>
  );
};

const VoiceCommandBar = ({
  status,
  error,
  activity,
  lastTranscript,
  lastResult,
  start,
  stop
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  lastTranscript: string;
  lastResult: ExecutionResult | null;
  start: () => void;
  stop: () => void;
}) => {
  const listening = status === 'listening';
  const label = error?.title ?? voiceStatusLabel(status);
  const summary = error?.message ?? (activity || lastResult?.message || '说出一句绘图指令，画布会立刻响应。');

  return (
    <header className={`voice-command-bar ${status}`}>
      <div className="brand-block">
        <p className="eyebrow">Speak2Draw-Agent-Studio</p>
        <h1>纯语音绘图工作台</h1>
      </div>
      <div className="voice-center">
        <button
          className={`mic-control ${listening ? 'active' : ''}`}
          onClick={listening ? stop : start}
          disabled={status === 'unsupported' || status === 'starting'}
          title={listening ? '停止语音监听' : '启动语音监听'}
          aria-label={listening ? '停止语音监听' : '启动语音监听'}
        >
          {listening ? <MicOff size={24} /> : <Mic size={24} />}
        </button>
        <div className="voice-copy">
          <div className="voice-status-line">
            <span className="live-dot" />
            <strong>{label}</strong>
          </div>
          <p>{summary}</p>
        </div>
        <Waveform active={listening || status === 'starting'} />
      </div>
      <div className="transcript-pill" title={lastTranscript}>
        <span>最近听到</span>
        <strong>{lastTranscript}</strong>
      </div>
    </header>
  );
};

const CanvasStage = ({ scene, selected }: { scene: SceneState; selected?: SceneObject }) => (
  <section className="canvas-stage canvas-panel" aria-label="绘图画布">
    <div className="canvas-toolbar">
      <div>
        <p className="eyebrow">画布</p>
        <h2>{scene.objects.length ? `${scene.objects.length} 个对象正在画布中` : '准备开始创作'}</h2>
      </div>
      <div className="canvas-badges">
        <span>{selected?.name ?? '未选中'}</span>
        <span>SVG</span>
      </div>
    </div>
    <div className="canvas-surface">
      {scene.objects.length === 0 ? (
        <div className="empty-canvas-hint">
          <Sparkles size={18} />
          <strong>试试说：画一个红色圆形</strong>
        </div>
      ) : null}
      <DrawingCanvas scene={scene} />
    </div>
  </section>
);

const DrawingCanvas = ({ scene }: { scene: SceneState }) => (
  <svg className="drawing-canvas" viewBox="0 0 960 600" role="img" aria-label="语音绘图画布">
    <defs>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e4e9f2" strokeWidth="1" />
      </pattern>
      <pattern id="major-grid" width="160" height="160" patternUnits="userSpaceOnUse">
        <path d="M 160 0 L 0 0 0 160" fill="none" stroke="#cad3e1" strokeWidth="1.2" />
      </pattern>
    </defs>
    <rect width="960" height="600" fill="#ffffff" />
    <rect width="960" height="600" fill="url(#grid)" />
    <rect width="960" height="600" fill="url(#major-grid)" opacity="0.55" />
    {scene.objects.map((object) => {
      const selectedObject = scene.objects.find((item) => item.id === scene.selectedId);
      const selected = object.id === scene.selectedId || Boolean(selectedObject?.groupId && selectedObject.groupId === object.groupId);
      return <SceneObjectView key={object.id} object={object} selected={selected} />;
    })}
  </svg>
);

const SceneObjectView = ({ object, selected }: { object: SceneObject; selected: boolean }) => {
  const selection = selected ? <rect className="selection-box" x={object.x - 10} y={object.y - 10} width={object.width + 20} height={object.height + 20} rx="8" /> : null;
  if (object.kind === 'circle') {
    const radius = Math.min(object.width, object.height) / 2;
    return (
      <g>
        {selection}
        <circle cx={object.x + radius} cy={object.y + radius} r={radius} {...svgStyle(object)} />
      </g>
    );
  }
  if (object.kind === 'ellipse') {
    return (
      <g>
        {selection}
        <ellipse cx={object.x + object.width / 2} cy={object.y + object.height / 2} rx={object.width / 2} ry={object.height / 2} {...svgStyle(object)} />
      </g>
    );
  }
  if (object.kind === 'line') {
    return (
      <g>
        {selection}
        <line x1={object.x} y1={object.y} x2={object.x + object.width} y2={object.y + object.height} stroke={object.style.stroke} strokeWidth={object.style.strokeWidth} strokeLinecap="round" />
      </g>
    );
  }
  if (object.kind === 'triangle') {
    const points = `${object.x + object.width / 2},${object.y} ${object.x + object.width},${object.y + object.height} ${object.x},${object.y + object.height}`;
    return (
      <g>
        {selection}
        <polygon points={points} {...svgStyle(object)} />
      </g>
    );
  }
  if (object.kind === 'text') {
    return (
      <g>
        {selection}
        <text x={object.x} y={object.y + object.height / 2} fill={object.style.stroke} fontSize="32" fontFamily="Arial, sans-serif">
          {object.text ?? '文字'}
        </text>
      </g>
    );
  }
  return (
    <g>
      {selection}
      <rect x={object.x} y={object.y} width={object.width} height={object.height} rx="8" {...svgStyle(object)} />
    </g>
  );
};

const StatusBlock = ({ status, error, activity }: { status: string; error: ReturnType<typeof useSpeechInput>['error']; activity: string }) => {
  const fallbackText =
    status === 'unsupported'
      ? '当前浏览器不支持 Web Speech API'
      : status === 'starting'
        ? '正在请求麦克风权限'
      : status === 'listening'
        ? '正在监听语音'
        : status === 'error'
          ? '语音识别出现错误'
          : '尚未开始监听';
  return (
    <section className={`status-block ${status}`}>
      <div className="status-icon">{status === 'listening' ? <Mic size={20} /> : <RotateCcw size={20} />}</div>
      <div>
        <h2>{error?.title ?? '语音状态'}</h2>
        <p>{error?.message ?? fallbackText}</p>
        <p className="status-activity">{activity}</p>
        {error?.action ? <p className="status-action">{error.action}</p> : null}
      </div>
    </section>
  );
};

const StatusRail = ({
  status,
  error,
  activity,
  aiStatus,
  clarification,
  selected,
  objectCount,
  lastTranscript,
  lastResult,
  micTestStatus,
  micTestResult,
  onMicrophoneTest
}: {
  status: string;
  error: ReturnType<typeof useSpeechInput>['error'];
  activity: string;
  aiStatus: AiResolutionStatus;
  clarification: ClarificationState | null;
  selected?: SceneObject;
  objectCount: number;
  lastTranscript: string;
  lastResult: ExecutionResult | null;
  micTestStatus: 'idle' | 'testing';
  micTestResult: MicrophoneTestResult | null;
  onMicrophoneTest: () => void;
}) => (
  <aside className="side-panel status-rail" aria-label="语音状态">
    <StatusBlock status={status} error={error} activity={activity} />
    <AiStatusBlock status={aiStatus} />
    {clarification ? <InfoBlock title="等待补充" value={clarification.question} tone="warning" /> : null}
    <ObjectInspector selected={selected} objectCount={objectCount} lastResult={lastResult} />
    <MicrophoneTestBlock status={micTestStatus} result={micTestResult} onTest={onMicrophoneTest} />
    <InfoBlock title="最近听到" value={lastTranscript} />
    <InfoBlock title="系统反馈" value={lastResult?.message ?? '启动监听后，说出绘图指令。'} tone={lastResult?.ok === false ? 'warning' : 'default'} />
  </aside>
);

const MicrophoneTestBlock = ({
  status,
  result,
  onTest
}: {
  status: 'idle' | 'testing';
  result: MicrophoneTestResult | null;
  onTest: () => void;
}) => (
  <section className={`mic-test-block ${result ? (result.ok ? 'ok' : 'failed') : ''}`}>
    <div className="mic-test-header">
      <h2>麦克风输入测试</h2>
      <button className="text-button" type="button" onClick={onTest} disabled={status === 'testing'}>
        <Volume2 size={16} />
        {status === 'testing' ? '测试中' : '测试麦克风'}
      </button>
    </div>
    <p>{status === 'testing' ? '请对着麦克风说话 3 秒。' : '这个测试只看麦克风音量，不依赖语音识别服务。'}</p>
    {result ? (
      <div className="mic-test-result">
        <strong>{result.title}</strong>
        <p>{result.message}</p>
        <div className="level-meter" aria-label={`麦克风峰值 ${(result.peak * 100).toFixed(1)}%`}>
          <span style={{ width: `${Math.min(100, result.peak * 100)}%` }} />
        </div>
        <p className="status-action">{result.action}</p>
      </div>
    ) : null}
  </section>
);

const AiStatusBlock = ({ status }: { status: AiResolutionStatus }) => (
  <section className={`ai-status-block ${status.state}`} aria-label="AI 解析状态">
    <div className="panel-heading">
      <BrainCircuit size={17} />
      <h2>AI 解析</h2>
    </div>
    <p>{humanAiMessage(status)}</p>
  </section>
);

const ObjectInspector = ({ selected, objectCount, lastResult }: { selected?: SceneObject; objectCount: number; lastResult: ExecutionResult | null }) => (
  <section className="object-inspector">
    <div className="panel-heading">
      <MousePointer2 size={17} />
      <h2>当前对象</h2>
    </div>
    <div className="object-summary">
      <div className="object-swatch" style={{ background: selected?.style.fill && selected.style.fill !== 'none' ? selected.style.fill : selected?.style.stroke ?? '#d7dee9' }} />
      <div>
        <strong>{selected?.name ?? '未选择对象'}</strong>
        <p>{selected ? `${shapeKindLabel(selected.kind)}${selected.groupName ? ` · ${selected.groupName}` : ''}` : '说“选择最后一个图形”可定位目标。'}</p>
      </div>
    </div>
    <dl className="metrics">
      <div>
        <dt>画布对象</dt>
        <dd>{objectCount}</dd>
      </div>
      <div>
        <dt>当前选择</dt>
        <dd>{selected?.name ?? '无'}</dd>
      </div>
      <div>
        <dt>最近延迟</dt>
        <dd>{lastResult ? `${lastResult.latencyMs}ms` : '-'}</dd>
      </div>
    </dl>
  </section>
);

const CommandGuide = () => (
  <section className="command-guide command-list" aria-label="可说的指令">
    <div className="panel-heading">
      <Bot size={18} />
      <h2>可说的指令</h2>
    </div>
    <div className="command-groups">
      {COMMAND_GROUPS.map((group) => (
        <div className="command-group" key={group.title}>
          <h3>{group.title}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </section>
);

const HistoryTimeline = ({ history }: { history: HistoryItem[] }) => (
  <section className="history-strip" aria-label="执行记录">
    <div className="history-heading">
      <Sparkles size={18} />
      <h2>执行记录</h2>
    </div>
    {history.length ? (
      <ol>
        {history.map((item, index) => (
          <li key={`${item.transcript}-${index}`}>
            <span>{item.source}</span>
            <strong>{item.transcript}</strong>
            <p>{item.message}</p>
          </li>
        ))}
      </ol>
    ) : (
      <p>暂无记录</p>
    )}
  </section>
);

const InfoBlock = ({ title, value, tone = 'default' }: { title: string; value: string; tone?: 'default' | 'warning' }) => (
  <section className={`info-block ${tone}`}>
    <h2>{title}</h2>
    <p>{value}</p>
  </section>
);

const Waveform = ({ active }: { active: boolean }) => (
  <div className={`waveform ${active ? 'active' : ''}`} aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => (
      <span key={index} />
    ))}
  </div>
);

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
  return '待命';
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
  { title: '创建', items: ['画一个红色圆形', '画一个房子和太阳', '写文字你好'] },
  { title: '编辑', items: ['把它改成黄色', '向右移动一点', '把文字改成世界'] },
  { title: '组织', items: ['把所有图形成组', '把所有图形左对齐', '水平分布所有图形'] },
  { title: 'AI 创作', items: ['画一只戴帽子的猫', '月亮换个梦幻感'] },
  { title: '查询', items: ['画布里有什么', '当前选中的是什么'] },
  { title: '历史', items: ['撤销', '重做', '导出图片'] }
];
