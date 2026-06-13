import { mapSpeechError } from './speechErrors';

export interface MicrophoneLevel {
  peak: number;
  average: number;
}

export interface MicrophoneTestResult extends MicrophoneLevel {
  ok: boolean;
  title: string;
  message: string;
  action: string;
}

export interface MicrophoneInputSample extends MicrophoneLevel {
  elapsedMs: number;
}

export const runMicrophoneInputTest = async (
  durationMs = 3000,
  onSample?: (sample: MicrophoneInputSample) => void
): Promise<MicrophoneTestResult> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      title: '无法测试麦克风',
      message: '当前浏览器不支持直接读取麦克风输入。',
      action: '请使用最新版 Chrome 或 Edge 后再测试。',
      peak: 0,
      average: 0
    };
  }

  if (!window.AudioContext) {
    return {
      ok: false,
      title: '无法分析麦克风音量',
      message: '当前浏览器不支持 Web Audio API，无法判断麦克风是否收到声音。',
      action: '请使用最新版 Chrome 或 Edge 后再测试。',
      peak: 0,
      average: 0
    };
  }

  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let peak = 0;
    let total = 0;
    let samples = 0;
    const startedAt = performance.now();

    while (performance.now() - startedAt < durationMs) {
      analyser.getByteTimeDomainData(data);
      const level = readLevel(data);
      peak = Math.max(peak, level);
      total += level;
      samples += 1;
      onSample?.({
        peak,
        average: total / samples,
        elapsedMs: performance.now() - startedAt
      });
      await delay(80);
    }

    source.disconnect();
    return evaluateMicrophoneLevel({
      peak,
      average: samples > 0 ? total / samples : 0
    });
  } catch (error) {
    const info = mapSpeechError(error);
    return {
      ok: false,
      title: info.title,
      message: info.message,
      action: info.action,
      peak: 0,
      average: 0
    };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    await audioContext?.close();
  }
};

export const evaluateMicrophoneLevel = ({ peak, average }: MicrophoneLevel): MicrophoneTestResult => {
  if (peak >= 0.08 || average >= 0.025) {
    return {
      ok: true,
      title: '麦克风输入正常',
      message: `检测到清晰声音输入，峰值 ${(peak * 100).toFixed(1)}%，平均 ${(average * 100).toFixed(1)}%。`,
      action: '如果语音绘图仍不执行，问题更可能在浏览器语音识别服务、网络或语言识别结果上。',
      peak,
      average
    };
  }

  if (peak >= 0.025 || average >= 0.008) {
    return {
      ok: true,
      title: '麦克风有输入但声音偏小',
      message: `检测到较弱声音输入，峰值 ${(peak * 100).toFixed(1)}%，平均 ${(average * 100).toFixed(1)}%。`,
      action: '请靠近麦克风、提高系统输入音量，或在系统设置里选择正确的输入设备。',
      peak,
      average
    };
  }

  return {
    ok: false,
    title: '麦克风几乎没有输入',
    message: `几乎没有检测到声音，峰值 ${(peak * 100).toFixed(1)}%，平均 ${(average * 100).toFixed(1)}%。`,
    action: '这更像是麦克风设备、系统输入源或浏览器权限问题；请检查系统声音设置里的默认输入设备。',
    peak,
    average
  };
};

const readLevel = (data: Uint8Array) => {
  let sum = 0;
  for (const value of data) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length);
};

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
