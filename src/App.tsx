import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mic, MicOff, RotateCcw, Sparkles } from 'lucide-react';
import { planCommands } from './domain/commandPlanner';
import { executeDrawingCommands } from './domain/drawingExecutor';
import { parseIntent } from './domain/intentParser';
import { createEmptyScene } from './domain/sceneModel';
import type { ExecutionResult, SceneObject, SceneState, VoiceTranscript } from './domain/types';
import { useSpeechInput } from './voice/useSpeechInput';
import { speak } from './voice/voiceFeedback';

export const App = () => {
  const [scene, setScene] = useState<SceneState>(() => createEmptyScene());
  const sceneRef = useRef(scene);
  const [lastTranscript, setLastTranscript] = useState('等待语音指令');
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const handleTranscript = useCallback(
    (transcript: VoiceTranscript) => {
      const currentScene = sceneRef.current;
      const intent = parseIntent(transcript);
      const plan = planCommands(intent, currentScene);
      const result = executeDrawingCommands(currentScene, plan.commands, transcript, plan);
      setLastTranscript(transcript.text);
      setScene(result.scene);
      sceneRef.current = result.scene;
      setLastResult(result);
      setHistory((items) => [`${transcript.text} → ${result.message}`, ...items].slice(0, 8));
      speak(result.message);
      if (result.exportSvg) downloadSvg(result.exportSvg);
    },
    []
  );

  const { status, error, start, stop } = useSpeechInput(handleTranscript);
  const selected = useMemo(() => scene.objects.find((object) => object.id === scene.selectedId), [scene.objects, scene.selectedId]);

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
              <button className="icon-button" onClick={start} disabled={status === 'unsupported'} title="启动语音监听" aria-label="启动语音监听">
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
            <StatusBlock status={status} error={error} />
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

const StatusBlock = ({ status, error }: { status: string; error: string }) => {
  const text =
    status === 'unsupported'
      ? '当前浏览器不支持 Web Speech API'
      : status === 'listening'
        ? '正在监听语音'
        : status === 'error'
          ? error || '语音识别出现错误'
          : '尚未开始监听';
  return (
    <section className={`status-block ${status}`}>
      <div className="status-icon">{status === 'listening' ? <Mic size={20} /> : <RotateCcw size={20} />}</div>
      <div>
        <h2>语音状态</h2>
        <p>{text}</p>
      </div>
    </section>
  );
};

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
