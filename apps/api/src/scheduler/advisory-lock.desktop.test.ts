import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: () => ({ SCHEDULER_JOB_TIMEOUT_MS: 1_000 }) }));
vi.mock('../config/runtime-capabilities', () => ({
  runtimeCapabilities: () => ({ schedulerCoordination: 'single-process' }),
}));

import { SchedulerAdvisoryLock } from './advisory-lock';

describe('SchedulerAdvisoryLock under the desktop (single-process) profile', () => {
  it('runs the handler without taking the Postgres advisory lock', async () => {
    const tx = {};
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const db = { tryTransactionLock: vi.fn() };
    const lock = new SchedulerAdvisoryLock(prisma as never, db as never);
    const handler = vi.fn().mockResolvedValue('done');

    const result = await lock.runExclusively('backup', handler);

    // Always acquired (there is no peer to contend with) and the advisory lock is never consulted.
    expect(result).toEqual({ acquired: true, value: 'done' });
    expect(handler).toHaveBeenCalledWith(tx);
    expect(db.tryTransactionLock).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 1_000,
      maxWait: 1_000,
    });
  });
});
