import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { createSqliteClient, sqliteCapabilities, type SqliteClient } from './support/client';
import { assertCaseVariantEmailsCollide } from './support/email-contract';

// The spike's silent-citext trap, made loud (issue #77). SQLite has no citext, so without the
// capability seam's normalization `A@x.com` and `a@x.com` become DISTINCT accounts with no error —
// a green "it ran" lane would miss the regression. These tests fail loudly if that guarantee is
// lost, and point the fix at apps/api/src/database/sqlite-database-capabilities.ts.

describe('citext parity on SQLite', () => {
  let client: SqliteClient;

  beforeAll(async () => {
    client = await createSqliteClient(inject('sqliteDatabaseUrl'));
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('rejects case-variant emails routed through the caseInsensitiveEmail strategy (the loud test)', async () => {
    await assertCaseVariantEmailsCollide(client.user, sqliteCapabilities(client), 'owner');
  });

  it('DEMONSTRATES the trap: un-normalized case variants are silently stored as distinct rows', async () => {
    // This is exactly what SQLite does WITHOUT the strategy — proving the seam is load-bearing and
    // not incidental. The two writes use raw (un-normalized) emails and both succeed.
    await client.user.create({
      data: { email: 'Trap@Example.com', displayName: 'Upper', passwordHash: 'hash' },
    });
    await client.user.create({
      data: { email: 'trap@example.com', displayName: 'Lower', passwordHash: 'hash' },
    });
    const stored = await client.user.count({
      where: { email: { in: ['Trap@Example.com', 'trap@example.com'] } },
    });
    expect(stored).toBe(2);
  });
});
