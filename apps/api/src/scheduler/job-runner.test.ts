import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobRunner } from './job-runner';
import type { JobDefinition } from './job-definition';

const tx = Symbol('tx');

function harness(definition: JobDefinition | undefined) {
  const registry = { get: vi.fn().mockReturnValue(definition) };
  const store = {
    read: vi.fn().mockResolvedValue(null),
    recordRun: vi.fn().mockResolvedValue(undefined),
  };
  // By default the lock is acquired and the callback runs against a stand-in transaction client.
  const lock = {
    runExclusively: vi.fn(
      async (_key: string, callback: (client: unknown) => Promise<unknown>) => ({
        acquired: true,
        value: await callback(tx),
      }),
    ),
  };
  const runner = new JobRunner(registry as never, lock as never, store as never);
  return { registry, store, lock, runner };
}

function job(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    key: 'backup',
    intervalMs: 1_000,
    handler: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('JobRunner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('ignores ticks for unregistered jobs', async () => {
    const { runner, lock } = harness(undefined);
    expect(await runner.runJob('ghost')).toEqual({ kind: 'unknown' });
    expect(lock.runExclusively).not.toHaveBeenCalled();
  });

  it('never executes a disabled job', async () => {
    const { runner, lock } = harness(job({ enabled: false }));
    expect(await runner.runJob('backup')).toEqual({ kind: 'disabled' });
    expect(lock.runExclusively).not.toHaveBeenCalled();
  });

  it('skips when another replica holds the lock', async () => {
    const { runner, lock } = harness(job());
    lock.runExclusively.mockResolvedValue({ acquired: false } as never);
    expect(await runner.runJob('backup')).toEqual({ kind: 'contended' });
  });

  it('runs a due job and records success', async () => {
    const definition = job();
    const { runner, store } = harness(definition);

    const result = await runner.runJob('backup');

    expect(result).toEqual({ kind: 'ran', outcome: 'SUCCESS' });
    expect(definition.handler).toHaveBeenCalledOnce();
    const record = store.recordRun.mock.calls[0]![2] as { nextDueAt: Date };
    expect(record).toMatchObject({ outcome: 'SUCCESS', error: null });
    expect(record.nextDueAt).toBeInstanceOf(Date);
  });

  it('records a handler failure without throwing and retains best-effort semantics', async () => {
    const definition = job({ handler: vi.fn().mockRejectedValue(new Error('disk full')) });
    const { runner, store } = harness(definition);

    const result = await runner.runJob('backup');

    expect(result).toEqual({ kind: 'ran', outcome: 'FAILURE' });
    expect(store.recordRun.mock.calls[0]![2]).toMatchObject({
      outcome: 'FAILURE',
      error: 'disk full',
    });
  });

  it('does not re-run a tick that another replica already claimed', async () => {
    const definition = job();
    const { runner, store } = harness(definition);
    store.read.mockResolvedValue({ nextDueAt: new Date(Date.now() + 60_000) });

    const result = await runner.runJob('backup');

    expect(result).toEqual({ kind: 'not-due' });
    expect(definition.handler).not.toHaveBeenCalled();
    expect(store.recordRun).not.toHaveBeenCalled();
  });

  it('runs when the recorded next-due time has already passed', async () => {
    const definition = job();
    const { runner, store } = harness(definition);
    store.read.mockResolvedValue({ nextDueAt: new Date(Date.now() - 60_000) });

    expect(await runner.runJob('backup')).toEqual({ kind: 'ran', outcome: 'SUCCESS' });
    expect(definition.handler).toHaveBeenCalledOnce();
  });

  it('swallows lock/database failures so a tick can never crash the process', async () => {
    const { runner, lock } = harness(job());
    lock.runExclusively.mockRejectedValue(new Error('connection reset'));

    expect(await runner.runJob('backup')).toEqual({ kind: 'contended' });
  });
});
