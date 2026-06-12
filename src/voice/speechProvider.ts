export interface SpeechProviderSettings {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
}

export const DEFAULT_SPEECH_PROVIDER_SETTINGS: SpeechProviderSettings = {
  lang: 'zh-CN',
  continuous: false,
  interimResults: true
};

export const getSpeechRecognitionConstructor = (host: Window = window) =>
  host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;

export const createBrowserSpeechRecognition = (
  settings: SpeechProviderSettings = DEFAULT_SPEECH_PROVIDER_SETTINGS,
  host: Window = window
) => {
  const Recognition = getSpeechRecognitionConstructor(host);
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = settings.lang;
  recognition.continuous = settings.continuous;
  recognition.interimResults = settings.interimResults;
  return recognition;
};
