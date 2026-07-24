import { describe, expect, it, vi } from 'vitest';
import { JobStatusStore } from './job-status-store';

function row(overrides: Record<string, unknown> = {}) {
  return {
    key: 'backup',
    enabled: true,
    lastRunAt: new Date('2026-07-24T00:00:00Z'),
    lastOutcome: 'SUCCESS',
    lastError: null,
    lastDurationMs: 12,
    lastRunReplica: 'replica-a',
    nextDueAt: new Date('2026-07-24T01:00:00Z'),
    runCount: 3,
    failureCount: 1,
    updatedAt: new Date('2026-07-24T00:00:01Z'),
    ...overrides,
  };
}

function prismaMock() {
  return {
    scheduledJobStatus: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('JobStatusStore', () => {
  it('seeds a status row without disturbing existing runtime state', async () => {
    const prisma = prismaMock();
    const store = new JobStatusStore(prisma as never);
    const nextDueAt = new Date('2026-07-24T01:00:00Z');

    await store.ensure('backup', true, nextDueAt);

    expect(prisma.scheduledJobStatus.upsert).toHaveBeenCalledWith({
      where: { key: 'backup' },
      create: { key: 'backup', enabled: true, nextDueAt },
      update: { enabled: true },
    });
  });

  it('records a successful tick, clearing any prior error', async () => {
    const prisma = prismaMock();
    const store = new JobStatusStore(prisma as never);
    const nextDueAt = new Date('2026-07-24T02:00:00Z');

    await store.recordRun(prisma as never, 'backup', {
      outcome: 'SUCCESS',
      error: null,
      durationMs: 42,
      nextDueAt,
      replica: 'replica-a',
    });

    const data = (
      prisma.scheduledJobStatus.update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toMatchObject({
      lastOutcome: 'SUCCESS',
      lastError: null,
      lastDurationMs: 42,
      lastRunReplica: 'replica-a',
      nextDueAt,
      runCount: { increment: 1 },
    });
    expect(data.failureCount).toBeUndefined();
    expect(data.lastRunAt).toBeInstanceOf(Date);
  });

  it('records a failed tick, incrementing the failure count and truncating the error', async () => {
    const prisma = prismaMock();
    const store = new JobStatusStore(prisma as never);

    await store.recordRun(prisma as never, 'backup', {
      outcome: 'FAILURE',
      error: 'x'.repeat(5_000),
      durationMs: 1,
      nextDueAt: new Date(),
      replica: 'replica-b',
    });

    const data = (
      prisma.scheduledJobStatus.update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data.lastOutcome).toBe('FAILURE');
    expect(data.failureCount).toEqual({ increment: 1 });
    expect((data.lastError as string).length).toBe(2_000);
  });

  it('falls back to a generic message when a failure has no error text', async () => {
    const prisma = prismaMock();
    const store = new JobStatusStore(prisma as never);

    await store.recordRun(prisma as never, 'backup', {
      outcome: 'FAILURE',
      error: null,
      durationMs: 1,
      nextDueAt: new Date(),
      replica: 'replica-b',
    });

    const data = (
      prisma.scheduledJobStatus.update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data.lastError).toBe('Unknown error');
  });

  it('reads a row within a transaction', async () => {
    const prisma = prismaMock();
    prisma.scheduledJobStatus.findUnique.mockResolvedValue(row());
    const store = new JobStatusStore(prisma as never);

    await store.read(prisma as never, 'backup');
    expect(prisma.scheduledJobStatus.findUnique).toHaveBeenCalledWith({ where: { key: 'backup' } });
  });

  it('maps a stored row to a status view', async () => {
    const prisma = prismaMock();
    prisma.scheduledJobStatus.findUnique.mockResolvedValue(row());
    const store = new JobStatusStore(prisma as never);

    const status = await store.get('backup');
    expect(status).toMatchObject({ key: 'backup', lastOutcome: 'SUCCESS', runCount: 3 });
  });

  it('returns null when no status row exists', async () => {
    const prisma = prismaMock();
    prisma.scheduledJobStatus.findUnique.mockResolvedValue(null);
    const store = new JobStatusStore(prisma as never);

    expect(await store.get('missing')).toBeNull();
  });

  it('lists all statuses ordered by key', async () => {
    const prisma = prismaMock();
    prisma.scheduledJobStatus.findMany.mockResolvedValue([row(), row({ key: 'digest' })]);
    const store = new JobStatusStore(prisma as never);

    const all = await store.list();
    expect(all.map((status) => status.key)).toEqual(['backup', 'digest']);
    expect(prisma.scheduledJobStatus.findMany).toHaveBeenCalledWith({ orderBy: { key: 'asc' } });
  });
});
