import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseReachable, queryDatabase, runDatabaseScript } from './support/postgres';

/**
 * Proves the Spaces migration is replay-safe against a live PostgreSQL, which is the property the
 * operator upgrade path depends on: `_prisma_migrations` travels inside the pg dump, so restoring
 * an N-1 archive rewinds the ledger and the next boot re-applies this migration against a database
 * where `spaces` and `space_resources` already exist with rows.
 *
 * Talks to the database through `docker compose exec postgres psql`, mirroring
 * `screenplay-collab.integration.test.ts`. It deliberately does NOT import `PrismaService`: the
 * integration lane drives a containerised app and never runs `prisma generate` in the runner's own
 * context, so importing the client throws "@prisma/client did not initialize yet" at module load.
 */

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000202';
const projectId = '00000000-0000-4000-8000-000000000203';
const screenplayId = '00000000-0000-4000-8000-000000000204';

const migrationSql = (): string =>
  readFileSync(resolve('apps/api/prisma/migrations/20260728000000_spaces/migration.sql'), 'utf8');

describe.runIf(databaseReachable())('Spaces migration replay', () => {
  it('applies twice with one Default Space, unique complete mappings, and zero memberships', () => {
    // A soft-deleted project and screenplay: the backfill must map trashed resources too, so a
    // restore from Trash lands somewhere rather than dangling outside every Space.
    runDatabaseScript(`
      INSERT INTO "users" ("id","email","display_name","password_hash","created_at","updated_at")
      VALUES ('${ownerId}'::uuid, 'spaces-migration@coda.local', 'Spaces Migration',
              'not-a-login-credential', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING;

      INSERT INTO "projects" ("id","owner_user_id","name","created_at","updated_at","deleted_at")
      VALUES ('${projectId}'::uuid, '${ownerId}'::uuid, 'Soft-deleted migration project',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING;

      INSERT INTO "screenplays" ("id","owner_user_id","title","filename","created_at","updated_at","deleted_at")
      VALUES ('${screenplayId}'::uuid, '${ownerId}'::uuid, 'Soft-deleted migration screenplay',
              'deleted.fountain', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING;
    `);

    try {
      const sql = migrationSql();
      runDatabaseScript(sql);
      runDatabaseScript(sql); // the replay that an N-1 restore forces

      expect(queryDatabase(`SELECT count(*) FROM "spaces" WHERE "is_default"`)).toBe('1');
      expect(
        queryDatabase(`SELECT count(*) FROM "spaces" WHERE "id" = '${DEFAULT_SPACE_ID}'::uuid`),
      ).toBe('1');

      // The load-bearing invariant of the whole epic: zero memberships means the upgrade grants
      // nobody access they did not already have.
      expect(queryDatabase(`SELECT count(*) FROM "space_memberships"`)).toBe('0');

      // Replay must not duplicate mappings.
      expect(
        queryDatabase(
          `SELECT count(*) FROM (SELECT "resource_type","resource_id" FROM "space_resources" ` +
            `GROUP BY 1,2 HAVING count(*) > 1) duplicates`,
        ),
      ).toBe('0');

      // Every resource is mapped, including the soft-deleted pair created above.
      expect(
        queryDatabase(
          `SELECT count(*) FROM "projects" p WHERE NOT EXISTS (SELECT 1 FROM "space_resources" s ` +
            `WHERE s."resource_type" = 'breakdown' AND s."resource_id" = p."id")`,
        ),
      ).toBe('0');
      expect(
        queryDatabase(
          `SELECT count(*) FROM "screenplays" x WHERE NOT EXISTS (SELECT 1 FROM "space_resources" s ` +
            `WHERE s."resource_type" = 'screenplay' AND s."resource_id" = x."id")`,
        ),
      ).toBe('0');
    } finally {
      runDatabaseScript(`
        DELETE FROM "space_resources" WHERE "resource_id" IN ('${projectId}'::uuid, '${screenplayId}'::uuid);
        DELETE FROM "screenplays" WHERE "id" = '${screenplayId}'::uuid;
        DELETE FROM "projects" WHERE "id" = '${projectId}'::uuid;
        DELETE FROM "users" WHERE "id" = '${ownerId}'::uuid;
      `);
    }
  }, 120_000);
});
