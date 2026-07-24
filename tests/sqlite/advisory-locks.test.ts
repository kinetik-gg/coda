import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { createSqliteClient, sqliteCapabilities, type SqliteClient } from './support/client';

// Proves the advisory-lock methods are channel-correct no-ops on SQLite (issue #77, portability
// note 1). The critical property: they run INSIDE a real SQLite transaction without throwing. A
// naive port that emitted `SELECT 1` on the execute channel would raise
// "Execute returned results, which is not allowed in SQLite" here. The fix lives at the seam:
// apps/api/src/database/sqlite-database-capabilities.ts.

describe('advisory locks and schema materialization on SQLite', () => {
  let client: SqliteClient;

  beforeAll(async () => {
    client = await createSqliteClient(inject('sqliteDatabaseUrl'));
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('runs the blocking and try locks inside a real transaction without emitting any statement', async () => {
    const db = sqliteCapabilities(client);

    const acquired = await client.$transaction(async (tx) => {
      await db.acquireTransactionLock(tx as never, 'project-lifecycle:p1');
      await db.acquireTransactionLockById(tx as never, 1_122_334_455n);
      return db.tryTransactionLock(tx as never, 0x53_43_48_44, 'backup');
    });

    // A single-process instance always wins the try-lock: no replica to skip for.
    expect(acquired).toBe(true);
  });

  it('materializes enum columns as portable strings (enum -> String transform)', async () => {
    const user = await client.user.create({
      data: { email: `enum-${Date.now()}@example.com`, displayName: 'Enum', passwordHash: 'hash' },
    });
    // UserStatus enum became a String column; the schema default persists as the string "ACTIVE".
    expect(user.status).toBe('ACTIVE');
  });
});
