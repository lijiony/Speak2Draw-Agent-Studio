import { describe, expect, it } from 'vitest';
import { DEFAULT_ENDPOINT_POLICY, ENDPOINT_POLICY_PRESETS, isEndpointPolicyOrdered, resolveEndpointPolicy } from './endpointPolicy';

describe('EndpointPolicy', () => {
  it('默认策略会先等停顿，再等中间结果稳定，最后才兜底超时', () => {
    expect(isEndpointPolicyOrdered(DEFAULT_ENDPOINT_POLICY)).toBe(true);
  });

  it('提供快速、均衡和耐心三档策略', () => {
    expect(Object.keys(ENDPOINT_POLICY_PRESETS)).toEqual(['fast', 'balanced', 'patient']);
    expect(ENDPOINT_POLICY_PRESETS.fast.speechEndGraceMs).toBeLessThan(
      ENDPOINT_POLICY_PRESETS.patient.speechEndGraceMs
    );
  });

  it('默认解析为均衡策略', () => {
    expect(resolveEndpointPolicy()).toBe(DEFAULT_ENDPOINT_POLICY);
    expect(resolveEndpointPolicy('fast')).toBe(ENDPOINT_POLICY_PRESETS.fast);
    expect(resolveEndpointPolicy('patient')).toBe(ENDPOINT_POLICY_PRESETS.patient);
  });
});
