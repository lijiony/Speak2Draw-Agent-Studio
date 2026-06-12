export interface SpeechErrorInfo {
  title: string;
  message: string;
  action: string;
}

export const mapSpeechError = (error: unknown): SpeechErrorInfo => {
  const name = getErrorName(error);

  if (name === 'not-allowed' || name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      title: '麦克风权限被拒绝',
      message: '浏览器拒绝了麦克风访问，所以语音绘图无法开始。',
      action: '请点击地址栏左侧的权限图标，将麦克风改为允许，然后刷新页面再启动监听。'
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: '未检测到麦克风',
      message: '当前设备没有可用麦克风，或系统没有把麦克风暴露给浏览器。',
      action: '请确认电脑已连接麦克风，并在系统设置中允许浏览器使用麦克风。'
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      title: '麦克风暂时不可用',
      message: '麦克风可能被其他应用占用，浏览器无法读取音频输入。',
      action: '请关闭正在使用麦克风的会议、录音或聊天软件，然后重新启动监听。'
    };
  }

  if (name === 'SecurityError' || name === 'insecure-context') {
    return {
      title: '当前页面不允许访问麦克风',
      message: '浏览器只允许 HTTPS、localhost 或 127.0.0.1 等安全来源访问麦克风。',
      action: '请使用 http://127.0.0.1:5173/ 或 localhost 打开应用，不要使用普通局域网地址。'
    };
  }

  if (name === 'InvalidStateError') {
    return {
      title: '语音识别正在运行',
      message: '浏览器认为语音识别器已经在启动或监听中，不能重复启动。',
      action: '请不要连续点击麦克风按钮；如果页面卡住，请先停止监听或刷新页面。'
    };
  }

  if (name === 'no-speech') {
    return {
      title: '没有检测到语音',
      message: '麦克风已经打开，但浏览器没有检测到清晰语音。',
      action: '请靠近麦克风，用普通语速说“画一个红色圆形”，并确认系统输入设备选择正确。'
    };
  }

  if (name === 'nomatch') {
    return {
      title: '没有识别出文字',
      message: '浏览器检测到了声音，但没有把它转换成可用文字。',
      action: '请换一句更短的指令，例如“画一个圆形”或“撤销”。'
    };
  }

  if (name === 'unsupported') {
    return {
      title: '浏览器不支持语音识别',
      message: '当前浏览器没有提供 Web Speech API，无法直接进行语音识别。',
      action: '请使用最新版 Chrome 或 Edge 打开应用。'
    };
  }

  return {
    title: '语音识别启动失败',
    message: `浏览器返回错误：${name || '未知错误'}。`,
    action: '请检查浏览器麦克风权限，刷新页面后重新启动监听。'
  };
};

export const getErrorName = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as { name?: unknown; error?: unknown; message?: unknown };
    if (typeof record.name === 'string' && record.name) return record.name;
    if (typeof record.error === 'string' && record.error) return record.error;
    if (typeof record.message === 'string' && record.message) return record.message;
  }
  return '';
};
