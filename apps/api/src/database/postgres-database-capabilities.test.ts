import { describe, expect, it, vi } from 'vitest';
import { PostgresDatabaseCapabilities } from './postgres-database-capabilities';

interface SqlTag {
  strings: string[];
  values: unknown[];
}

const sqlText = (tag: SqlTag): string => tag.strings.join('?');

describe('PostgresDatabaseCapabilities', () => {
  it('takes a blocking xact advisory lock keyed by a hashed string', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const db = new PostgresDatabaseCapabilities({} as never);

    await db.acquireTransactionLock({ $executeRaw: executeRaw } as never, 'project-lifecycle:p1');

    const tag = executeRaw.mock.calls[0]![0] as SqlTag;
    expect(sqlText(tag)).toBe('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))');
    expect(tag.values).toEqual(['project-lifecycle:p1']);
  });

  it('takes a blocking xact advisory lock on a fixed numeric id', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const db = new PostgresDatabaseCapabilities({} as never);

    await db.acquireTransactionLockById({ $executeRaw: executeRaw } as never, 1_122_334_455n);

    const tag = executeRaw.mock.calls[0]![0] as SqlTag;
    expect(sqlText(tag)).toBe('SELECT pg_advisory_xact_lock(?)');
    expect(tag.values).toEqual([1_122_334_455n]);
  });

  it('runs the non-blocking two-int try-lock and returns whether it was acquired', async () => {
    const db = new PostgresDatabaseCapabilities({} as never);
    const acquired = { $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]) };
    const contended = { $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]) };
    const empty = { $queryRaw: vi.fn().mockResolvedValue([]) };

    await expect(db.tryTransactionLock(acquired as never, 0x53_43_48_44, 'backup')).resolves.toBe(
      true,
    );
    await expect(db.tryTransactionLock(contended as never, 0x53_43_48_44, 'backup')).resolves.toBe(
      false,
    );
    await expect(db.tryTransactionLock(empty as never, 0x53_43_48_44, 'backup')).resolves.toBe(
      false,
    );

    const tag = acquired.$queryRaw.mock.calls[0]![0] as SqlTag;
    expect(sqlText(tag)).toBe('SELECT pg_try_advisory_xact_lock(?::int4, hashtext(?)) AS locked');
    expect(tag.values).toEqual([0x53_43_48_44, 'backup']);
  });

  it('claims the next deletion job with FOR UPDATE SKIP LOCKED and an interval cutoff', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 'job-1', objectKey: 'k', attempts: 2 }]);
    const db = new PostgresDatabaseCapabilities({ $queryRaw: queryRaw } as never);

    const claimed = await db.claimNextDeletionJob(5);

    const tag = queryRaw.mock.calls[0]![0] as SqlTag;
    const text = sqlText(tag);
    expect(text).toContain('FOR UPDATE SKIP LOCKED');
    expect(text).toContain('"not_before" <= CURRENT_TIMESTAMP');
    expect(text).toContain('"claim_token"');
    expect(text).toContain("INTERVAL '1 minute'");
    expect(text).not.toContain('"object_key" IN');
    // The staleness window and the fencing claim token are both bound as parameters.
    expect(tag.values).toContain(5);
    expect(claimed).toMatchObject({ id: 'job-1', objectKey: 'k', attempts: 2 });
    expect(claimed?.claimToken).toMatch(/^[0-9a-f-]{36}$/u);
    expect(tag.values).toContain(claimed?.claimToken);
  });

  it('returns null when there is no claimable deletion job', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = new PostgresDatabaseCapabilities({ $queryRaw: queryRaw } as never);

    await expect(db.claimNextDeletionJob(5)).resolves.toBeNull();
  });

  it('leaves email untouched because citext case-folds equality in the database', () => {
    const db = new PostgresDatabaseCapabilities({} as never);
    expect(db.caseInsensitiveEmail('Owner@Example.com')).toBe('Owner@Example.com');
  });
});
