import { describe, expect, it } from 'vitest';
import { computeStartupJitterMs, MAX_STARTUP_JITTER_MS } from './update-check-jitter';

describe('computeStartupJitterMs', () => {
  it('returns zero when polling is disabled', () => {
    expect(computeStartupJitterMs(0)).toBe(0);
    expect(computeStartupJitterMs(-1)).toBe(0);
  });

  it('stays within [0, intervalMs) for an interval below the jitter cap', () => {
    expect(computeStartupJitterMs(1_000, () => 0)).toBe(0);
    expect(computeStartupJitterMs(1_000, () => 0.999999)).toBeLessThan(1_000);
    expect(computeStartupJitterMs(1_000, () => 0.5)).toBe(500);
  });

  it('caps the jitter window at MAX_STARTUP_JITTER_MS for a long interval', () => {
    const dayMs = 24 * 60 * 60 * 1_000;
    expect(computeStartupJitterMs(dayMs, () => 0.999999)).toBeLessThan(MAX_STARTUP_JITTER_MS);
    expect(computeStartupJitterMs(dayMs, () => 1)).toBeLessThanOrEqual(MAX_STARTUP_JITTER_MS);
  });

  it('is uniformly bounded across the full random range', () => {
    for (const random of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      const jitter = computeStartupJitterMs(10 * 60 * 1_000, () => random);
      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThan(MAX_STARTUP_JITTER_MS);
    }
  });
});
