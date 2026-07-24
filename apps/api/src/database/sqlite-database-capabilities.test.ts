import { describe, expect, it, vi } from 'vitest';
import { SqliteDatabaseCapabilities } from './sqlite-database-capabilities';

describe('SqliteDatabaseCapabilities', () => {
  it('takes the blocking advisory locks as channel-correct no-ops that emit no statement', async () => {
    const executeRaw = vi.fn();
    const queryRaw = vi.fn();
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
    const db = new SqliteDatabaseCapabilities({} as never);

    await expect(
      db.acquireTransactionLock(tx as never, 'project-lifecycle:p1'),
    ).resolves.toBeUndefined();
    await expect(
      db.acquireTransactionLockById(tx as never, 1_122_334_455n),
    ).resolves.toBeUndefined();

    // Portability note 1: SQLite's execute channel rejects result-returning statements, so a
    // no-op must issue NO SQL at all — not `SELECT 1`.
    expect(executeRaw).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('always acquires the non-blocking try-lock — a single process has no replica to skip for', async () => {
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn() };
    const db = new SqliteDatabaseCapabilities({} as never);

    await expect(db.tryTransactionLock(tx as never, 0x53_43_48_44, 'backup')).resolves.toBe(true);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('claims the next deletion job with a JS-computed staleness cutoff and no SKIP LOCKED', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'job-1', objectKey: 'k', attempts: 2 });
    const update = vi.fn().mockResolvedValue({});
    const tx = { storageDeletionJob: { findFirst, update } };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const db = new SqliteDatabaseCapabilities(prisma as never);

    const before = Date.now();
    const claimed = await db.claimNextDeletionJob(5);
    const after = Date.now();

    expect(claimed).toMatchObject({ id: 'job-1', objectKey: 'k', attempts: 2 });
    expect(claimed?.claimToken).toMatch(/^[0-9a-f-]{36}$/u);

    // The staleness window is an ordinary JS Date subtraction, not an INTERVAL literal.
    const findArgs = findFirst.mock.calls[0]![0] as {
      where: { OR: [{ claimedAt: null }, { claimedAt: { lte: Date } }] };
    };
    const staleCutoff = findArgs.where.OR[1].claimedAt.lte.getTime();
    expect(staleCutoff).toBeGreaterThanOrEqual(before - 5 * 60_000);
    expect(staleCutoff).toBeLessThanOrEqual(after - 5 * 60_000);

    // The fencing token is stamped on the claimed row.
    const updateArgs = update.mock.calls[0]![0] as {
      where: { id: string };
      data: { claimToken: string };
    };
    expect(updateArgs.where).toEqual({ id: 'job-1' });
    expect(updateArgs.data.claimToken).toBe(claimed?.claimToken);
  });

  it('returns null when there is no claimable deletion job', async () => {
    const tx = {
      storageDeletionJob: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const db = new SqliteDatabaseCapabilities(prisma as never);

    await expect(db.claimNextDeletionJob(5)).resolves.toBeNull();
    expect(tx.storageDeletionJob.update).not.toHaveBeenCalled();
  });

  it('lower-cases email so case-variant addresses collide on the plain unique index', () => {
    const db = new SqliteDatabaseCapabilities({} as never);
    expect(db.caseInsensitiveEmail('Owner@Example.com')).toBe('owner@example.com');
    expect(db.caseInsensitiveEmail('OWNER@EXAMPLE.COM')).toBe('owner@example.com');
  });
});
