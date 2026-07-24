import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: () => ({ SCHEDULER_JOB_TIMEOUT_MS: 1_000 }) }));

import { SchedulerAdvisoryLock } from './advisory-lock';

function prismaWith(rows: unknown) {
  const tx = { $queryRaw: vi.fn().mockResolvedValue(rows) };
  const prisma = { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };
  return { tx, prisma };
}

describe('SchedulerAdvisoryLock', () => {
  it('runs the handler and returns its value when the lock is acquired', async () => {
    const { tx, prisma } = prismaWith([{ locked: true }]);
    const lock = new SchedulerAdvisoryLock(prisma as never);
    const handler = vi.fn().mockResolvedValue('done');

    const result = await lock.runExclusively('backup', handler);

    expect(result).toEqual({ acquired: true, value: 'done' });
    expect(handler).toHaveBeenCalledWith(tx);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 1_000,
      maxWait: 1_000,
    });
  });

  it('skips the handler when a concurrent replica already holds the lock', async () => {
    const { prisma } = prismaWith([{ locked: false }]);
    const lock = new SchedulerAdvisoryLock(prisma as never);
    const handler = vi.fn();

    const result = await lock.runExclusively('backup', handler);

    expect(result).toEqual({ acquired: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('treats a missing lock row as not acquired', async () => {
    const { prisma } = prismaWith([]);
    const lock = new SchedulerAdvisoryLock(prisma as never);
    const handler = vi.fn();

    const result = await lock.runExclusively('backup', handler);

    expect(result).toEqual({ acquired: false });
    expect(handler).not.toHaveBeenCalled();
  });
});
