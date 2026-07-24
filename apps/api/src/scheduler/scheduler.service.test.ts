import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envState = { SCHEDULER_HEARTBEAT_ENABLED: false, SCHEDULER_HEARTBEAT_INTERVAL_MS: 3_600_000 };
vi.mock('../config/env', () => ({ env: () => envState }));

import { HEARTBEAT_JOB_KEY } from './built-in-jobs';
import type { JobDefinition } from './job-definition';
import { SchedulerService } from './scheduler.service';

function job(overrides: Partial<JobDefinition>): JobDefinition {
  return { key: 'job', intervalMs: 1_000, handler: () => Promise.resolve(), ...overrides };
}

function harness(jobs: JobDefinition[]) {
  const registry = { register: vi.fn(), all: vi.fn().mockReturnValue(jobs) };
  const runner = { runJob: vi.fn().mockResolvedValue(undefined) };
  const store = { ensure: vi.fn().mockResolvedValue(undefined) };
  const schedulerRegistry = {
    addInterval: vi.fn(),
    deleteInterval: vi.fn(),
    getIntervals: vi.fn().mockReturnValue([]),
  };
  const service = new SchedulerService(
    registry as never,
    runner as never,
    store as never,
    schedulerRegistry as never,
  );
  return { registry, runner, store, schedulerRegistry, service };
}

describe('SchedulerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    envState.SCHEDULER_HEARTBEAT_ENABLED = false;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers the heartbeat job on init when enabled', () => {
    envState.SCHEDULER_HEARTBEAT_ENABLED = true;
    const { service, registry } = harness([]);

    service.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ key: HEARTBEAT_JOB_KEY }),
    );
  });

  it('registers no built-in job on init when the heartbeat is disabled', () => {
    const { service, registry } = harness([]);
    service.onModuleInit();
    expect(registry.register).not.toHaveBeenCalled();
  });

  it('arms enabled jobs, seeds status, and fires startup ticks on bootstrap', async () => {
    const jobs = [
      job({ key: 'interval-only', enabled: true }),
      job({ key: 'disabled', enabled: false }),
      job({ key: 'startup', enabled: true, runOnStartup: true }),
    ];
    const { service, store, runner, schedulerRegistry } = harness(jobs);

    await service.onApplicationBootstrap();

    expect(store.ensure).toHaveBeenCalledTimes(3);
    expect(schedulerRegistry.addInterval.mock.calls.map((call) => call[0] as string)).toEqual([
      'interval-only',
      'startup',
    ]);
    expect(runner.runJob).toHaveBeenCalledExactlyOnceWith('startup');
  });

  it('seeds a startup job with an immediately-due next-due time and interval jobs in the future', async () => {
    const jobs = [
      job({ key: 'startup', enabled: true, runOnStartup: true }),
      job({ key: 'interval', enabled: true }),
    ];
    const { service, store } = harness(jobs);

    await service.onApplicationBootstrap();

    expect(store.ensure).toHaveBeenNthCalledWith(1, 'startup', true, null);
    expect(store.ensure.mock.calls[1]![2]).toBeInstanceOf(Date);
  });

  it('clears only the intervals it owns on destroy', () => {
    const jobs = [job({ key: 'a' }), job({ key: 'b' })];
    const { service, schedulerRegistry } = harness(jobs);
    schedulerRegistry.getIntervals.mockReturnValue(['a']);

    service.onModuleDestroy();

    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledExactlyOnceWith('a');
  });
});
