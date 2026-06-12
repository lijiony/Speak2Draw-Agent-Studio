export interface EndpointPolicy {
  noSpeechTimeoutMs: number;
  speechEndGraceMs: number;
  interimStabilityMs: number;
  finalResultTimeoutMs: number;
  restartDelayMs: number;
}

export type EndpointPolicyMode = 'fast' | 'balanced' | 'patient';

export const DEFAULT_ENDPOINT_POLICY: EndpointPolicy = {
  noSpeechTimeoutMs: 12000,
  speechEndGraceMs: 2800,
  interimStabilityMs: 6000,
  finalResultTimeoutMs: 10000,
  restartDelayMs: 300
};

export const ENDPOINT_POLICY_PRESETS = {
  fast: {
    noSpeechTimeoutMs: 9000,
    speechEndGraceMs: 1800,
    interimStabilityMs: 4200,
    finalResultTimeoutMs: 8000,
    restartDelayMs: 250
  },
  balanced: DEFAULT_ENDPOINT_POLICY,
  patient: {
    noSpeechTimeoutMs: 15000,
    speechEndGraceMs: 4200,
    interimStabilityMs: 8000,
    finalResultTimeoutMs: 13000,
    restartDelayMs: 350
  }
} satisfies Record<EndpointPolicyMode, EndpointPolicy>;

export const isEndpointPolicyOrdered = (policy: EndpointPolicy) =>
  policy.speechEndGraceMs < policy.interimStabilityMs &&
  policy.interimStabilityMs < policy.finalResultTimeoutMs &&
  policy.restartDelayMs < policy.speechEndGraceMs;

export const resolveEndpointPolicy = (mode: EndpointPolicyMode = 'balanced') => ENDPOINT_POLICY_PRESETS[mode];
