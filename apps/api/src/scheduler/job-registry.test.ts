import { describe, expect, it } from 'vitest';
import { JobRegistry } from './job-registry';
import type { JobDefinition } from './job-definition';

function job(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return { key: 'backup', intervalMs: 1_000, handler: () => Promise.resolve(), ...overrides };
}

describe('JobRegistry', () => {
  it('registers a job and applies enabled/runOnStartup defaults', () => {
    const registry = new JobRegistry();
    registry.register(job());

    const stored = registry.get('backup');
    expect(stored).toMatchObject({ key: 'backup', enabled: true, runOnStartup: false });
    expect(registry.all()).toHaveLength(1);
  });

  it('preserves explicit enabled and runOnStartup flags', () => {
    const registry = new JobRegistry();
    registry.register(job({ enabled: false, runOnStartup: true }));

    expect(registry.get('backup')).toMatchObject({ enabled: false, runOnStartup: true });
  });

  it('rejects a duplicate key', () => {
    const registry = new JobRegistry();
    registry.register(job());
    expect(() => registry.register(job())).toThrow(/already registered/u);
  });

  it('rejects an empty key', () => {
    const registry = new JobRegistry();
    expect(() => registry.register(job({ key: '  ' }))).toThrow(/non-empty key/u);
  });

  it('rejects a non-positive or non-integer interval', () => {
    const registry = new JobRegistry();
    expect(() => registry.register(job({ intervalMs: 0 }))).toThrow(/positive interval/u);
    expect(() => registry.register(job({ key: 'other', intervalMs: 1.5 }))).toThrow(
      /positive interval/u,
    );
  });

  it('returns undefined for an unknown key', () => {
    expect(new JobRegistry().get('missing')).toBeUndefined();
  });
});
