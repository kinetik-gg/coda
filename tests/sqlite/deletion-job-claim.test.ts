import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { createSqliteClient, sqliteCapabilities, type SqliteClient } from './support/client';

// Proves DatabaseCapabilities.claimNextDeletionJob works on SQLite with NO `FOR UPDATE SKIP LOCKED`
// and NO `INTERVAL` literal — the staleness cutoff is a JS Date and the claim is an ordinary
// transactional read-then-update. See apps/api/src/database/sqlite-database-capabilities.ts.

const STALE_MINUTES = 5;

describe('storage-deletion claim on SQLite', () => {
  let client: SqliteClient;

  beforeAll(async () => {
    client = await createSqliteClient(inject('sqliteDatabaseUrl'));
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('claims only the eligible job, fences it with a token, and then finds nothing claimable', async () => {
    const db = sqliteCapabilities(client);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60 * 60_000);

    const eligible = await client.storageDeletionJob.create({
      data: { projectId: 'p1', objectKey: `eligible-${Date.now()}`, notBefore: past },
    });
    await client.storageDeletionJob.create({
      data: { projectId: 'p1', objectKey: `future-${Date.now()}`, notBefore: future },
    });

    const claimed = await db.claimNextDeletionJob(STALE_MINUTES);
    expect(claimed?.id).toBe(eligible.id);
    expect(claimed?.claimToken).toMatch(/^[0-9a-f-]{36}$/u);

    // The just-claimed row is no longer eligible and the future row is still gated, so nothing is
    // claimable — no skip-locked contention needed in a single-writer database.
    await expect(db.claimNextDeletionJob(STALE_MINUTES)).resolves.toBeNull();
  });

  it('reclaims a job whose prior claim is older than the JS staleness cutoff', async () => {
    const db = sqliteCapabilities(client);
    const stale = new Date(Date.now() - (STALE_MINUTES + 10) * 60_000);

    const job = await client.storageDeletionJob.create({
      data: {
        projectId: 'p2',
        objectKey: `stale-${Date.now()}`,
        notBefore: new Date(Date.now() - 60_000),
        claimToken: '00000000-0000-0000-0000-000000000000',
        claimedAt: stale,
      },
    });

    const reclaimed = await db.claimNextDeletionJob(STALE_MINUTES);
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.claimToken).not.toBe('00000000-0000-0000-0000-000000000000');
  });
});
