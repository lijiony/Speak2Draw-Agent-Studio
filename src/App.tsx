import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mic, MicOff, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import { resolveAiIntent, shouldUseAiIntentFallback } from './ai/aiIntentClient';
import type { AiClarificationContext } from './ai/aiIntentContract';
import { planCommands } from './domain/commandPlanner';
import { executeDrawingCommands } from './domain/drawingExecutor';
import { parseIntent } from './domain/intentParser';
import { createEmptyScene } from './domain/sceneModel';
import type { ExecutionResult, SceneObject, SceneState, VoiceTranscript } from './domain/types';
import { runMicrophoneInputTest, type MicrophoneTestResult } from './voice/microphoneTest';
import { useSpeechInput } from './voice/useSpeechInput';
import { speak } from './voice/voiceFeedback';

type AiResolutionStatus = {
  state: 'idle' | 'local' | 'checking' | 'used' | 'fallback';
  message: string;
};

type ClarificationState = AiClarificationContext & {
  waiting: true;
};

declare global {
  interface Window {
    __speak2drawTest?: {
      submitTranscript: (text: string, confidence?: number) => Promise<void>;
      getScene: () => SceneState;
      getAiStatus: () => AiResolutionStatus;
      getClarification: () => ClarificationState | null;
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
  const [history, setHistory] = useState<string[]>([]);

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
      setHistory((items) => [`${transcript.text} → ${result.message}（${aiHistoryLabel}）`, ...items].slice(0, 8));
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
      getClarification: () => clarificationRef.current
    };

    return () => {
      delete window.__speak2drawTest;
    };
  }, [handleTranscript]);

  const { status, error, activity, start, stop } = useSpeechInput(handleTranscript);
  const selected = useMemo(() => scene.objects.find((object) => object.id === scene.selectedId), [scene.objects, scene.selectedId]);

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
        <header className="topbar">
          <div>
            <p className="eyebrow">Speak2Draw-Agent-Studio</p>
            <h1>纯语音绘图工作台</h1>
          </div>
          <div className="voice-controls">
            {status === 'listening' ? (
              <button className="icon-button active" onClick={stop} title="停止语音监听" aria-label="停止语音监听">
                <MicOff size={22} />
              </button>
            ) : (
              <button className="icon-button" onClick={start} disabled={status === 'unsupported' || status === 'starting'} title="启动语音监听" aria-label="启动语音监听">
                <Mic size={22} />
              </button>
            )}
          </div>
        </header>

        <div className="content-grid">
          <section className="canvas-panel" aria-label="绘图画布">
            <DrawingCanvas scene={scene} />
          </section>

          <aside className="side-panel" aria-label="语音状态">
            <StatusBlock status={status} error={error} activity={activity} />
            <MicrophoneTestBlock status={micTestStatus} result={micTestResult} onTest={handleMicrophoneTest} />
            <AiStatusBlock status={aiStatus} />
            {clarification ? <InfoBlock title="等待补充" value={clarification.question} /> : null}
            <InfoBlock title="最近听到" value={lastTranscript} />
            <InfoBlock title="系统反馈" value={lastResult?.message ?? '启动监听后，说出绘图指令。'} />
            <dl className="metrics">
              <div>
                <dt>画布对象</dt>
                <dd>{scene.objects.length}</dd>
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
            <section className="command-list" aria-label="可说的指令">
              <h2>可说的指令</h2>
              <ul>
                <li>画一个红色圆形</li>
                <li>选择最后一个图形</li>
                <li>把它改成黄色</li>
                <li>向右移动一点</li>
                <li>画一个房子和太阳</li>
                <li>画一个蓝色圆形叫月亮</li>
                <li>画一个蓝色圆形和绿色矩形</li>
                <li>画布里有什么 / 当前选中的是什么</li>
                <li>撤销 / 重做 / 导出图片</li>
              </ul>
            </section>
          </aside>
        </div>
      </section>

      <section className="history-strip" aria-label="执行记录">
        <div className="history-heading">
          <Sparkles size={18} />
          <h2>执行记录</h2>
        </div>
        {history.length ? (
          <ol>
            {history.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ol>
        ) : (
          <p>暂无记录</p>
        )}
      </section>
    </main>
  );
};

const DrawingCanvas = ({ scene }: { scene: SceneState }) => (
  <svg viewBox="0 0 960 600" role="img" aria-label="语音绘图画布">
    <defs>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e7eb" strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="960" height="600" fill="#ffffff" />
    <rect width="960" height="600" fill="url(#grid)" />
    {scene.objects.map((object) => (
      <SceneObjectView key={object.id} object={object} selected={object.id === scene.selectedId} />
    ))}
  </svg>
);

const SceneObjectView = ({ object, selected }: { object: SceneObject; selected: boolean }) => {
  const selection = selected ? <rect className="selection-box" x={object.x - 8} y={object.y - 8} width={object.width + 16} height={object.height + 16} rx="10" /> : null;
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
    <h2>AI 解析</h2>
    <p>{status.message}</p>
  </section>
);

const InfoBlock = ({ title, value }: { title: string; value: string }) => (
  <section className="info-block">
    <h2>{title}</h2>
    <p>{value}</p>
  </section>
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
