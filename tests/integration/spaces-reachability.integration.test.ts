import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseReachable, queryDatabase, runDatabaseScript } from './support/postgres';

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';
const aliceId = '00000000-0000-4000-8000-000000000261';
const bobId = '00000000-0000-4000-8000-000000000262';
const aliceProjectId = '00000000-0000-4000-8000-000000000263';
const sharedProjectId = '00000000-0000-4000-8000-000000000264';
const bobScreenplayId = '00000000-0000-4000-8000-000000000265';
const sharedScreenplayId = '00000000-0000-4000-8000-000000000266';
const resourceIds = [aliceProjectId, sharedProjectId, bobScreenplayId, sharedScreenplayId];

const migrationSql = (): string =>
  readFileSync(resolve('apps/api/prisma/migrations/20260728000000_spaces/migration.sql'), 'utf8');

function snapshot(addSpaceReach: boolean): Record<string, string[]> {
  const spaceReach = addSpaceReach
    ? `
      UNION
      SELECT sm."user_id", sr."resource_type", sr."resource_id"
      FROM "space_memberships" sm
      JOIN "space_roles" role ON role."id" = sm."role_id"
        AND role."space_id" = sm."space_id" AND role."archived_at" IS NULL
      JOIN "spaces" space ON space."id" = sm."space_id" AND space."deleted_at" IS NULL
      JOIN "space_resources" sr ON sr."space_id" = space."id"
      WHERE sm."user_id" IN ('${aliceId}'::uuid, '${bobId}'::uuid)
        AND role."resource_tier" IN ('viewer', 'contributor', 'manager')`
    : '';
  const raw = queryDatabase(`
    WITH reachable AS (
      SELECT pm."user_id", 'breakdown'::text AS "resource_type", pm."project_id" AS "resource_id"
      FROM "project_memberships" pm
      JOIN "project_roles" role ON role."id" = pm."role_id" AND role."archived_at" IS NULL
      JOIN "project_role_permissions" permission ON permission."role_id" = role."id"
        AND permission."permission" = 'read_project'
      JOIN "projects" project ON project."id" = pm."project_id" AND project."deleted_at" IS NULL
      WHERE pm."user_id" IN ('${aliceId}'::uuid, '${bobId}'::uuid)
      UNION
      SELECT sm."user_id", 'screenplay'::text, sm."screenplay_id"
      FROM "screenplay_memberships" sm
      JOIN "screenplay_roles" role ON role."id" = sm."role_id" AND role."archived_at" IS NULL
      JOIN "screenplay_role_permissions" permission ON permission."role_id" = role."id"
        AND permission."permission" = 'read_screenplay'
      JOIN "screenplays" screenplay ON screenplay."id" = sm."screenplay_id"
        AND screenplay."deleted_at" IS NULL
      WHERE sm."user_id" IN ('${aliceId}'::uuid, '${bobId}'::uuid)
      ${spaceReach}
    )
    SELECT jsonb_build_object(
      '${aliceId}', COALESCE((
        SELECT jsonb_agg("resource_type" || ':' || "resource_id" ORDER BY "resource_type", "resource_id")
        FROM reachable WHERE "user_id" = '${aliceId}'::uuid
      ), '[]'::jsonb),
      '${bobId}', COALESCE((
        SELECT jsonb_agg("resource_type" || ':' || "resource_id" ORDER BY "resource_type", "resource_id")
        FROM reachable WHERE "user_id" = '${bobId}'::uuid
      ), '[]'::jsonb)
    );
  `);
  return JSON.parse(raw) as Record<string, string[]>;
}

function cleanup(): void {
  const ids = resourceIds.map((id) => `'${id}'::uuid`).join(', ');
  runDatabaseScript(`
    DELETE FROM "space_resources" WHERE "resource_id" IN (${ids});
    DELETE FROM "space_memberships" WHERE "user_id" IN ('${aliceId}'::uuid, '${bobId}'::uuid);
    DELETE FROM "screenplay_memberships" WHERE "user_id" IN ('${aliceId}'::uuid, '${bobId}'::uuid);
    DELETE FROM "screenplay_roles" WHERE "screenplay_id" IN ('${bobScreenplayId}'::uuid, '${sharedScreenplayId}'::uuid);
    DELETE FROM "project_memberships" WHERE "user_id" IN ('${aliceId}'::uuid, '${bobId}'::uuid);
    DELETE FROM "projects" WHERE "id" IN ('${aliceProjectId}'::uuid, '${sharedProjectId}'::uuid);
    DELETE FROM "screenplays" WHERE "id" IN ('${bobScreenplayId}'::uuid, '${sharedScreenplayId}'::uuid);
    DELETE FROM "users" WHERE "id" IN ('${aliceId}'::uuid, '${bobId}'::uuid);
  `);
}

describe.runIf(databaseReachable())('Spaces upgrade reachability snapshot', () => {
  it('keeps every user resource set identical when the additive Space path is empty', () => {
    cleanup();
    runDatabaseScript(`
      INSERT INTO "users" ("id","email","display_name","password_hash","created_at","updated_at") VALUES
        ('${aliceId}'::uuid, 'spaces-snapshot-alice@coda.local', 'Snapshot Alice', 'not-a-login-credential', now(), now()),
        ('${bobId}'::uuid, 'spaces-snapshot-bob@coda.local', 'Snapshot Bob', 'not-a-login-credential', now(), now());
      INSERT INTO "projects" ("id","owner_user_id","name","created_at","updated_at") VALUES
        ('${aliceProjectId}'::uuid, '${aliceId}'::uuid, 'Alice private breakdown', now(), now()),
        ('${sharedProjectId}'::uuid, '${aliceId}'::uuid, 'Shared breakdown', now(), now());
      INSERT INTO "project_roles" ("id","project_id","name","position") VALUES
        ('00000000-0000-4000-8000-000000000267'::uuid, '${aliceProjectId}'::uuid, 'snapshot-reader', 'a'),
        ('00000000-0000-4000-8000-000000000268'::uuid, '${sharedProjectId}'::uuid, 'snapshot-reader', 'a');
      INSERT INTO "project_role_permissions" ("id","role_id","permission") VALUES
        ('00000000-0000-4000-8000-000000000269'::uuid, '00000000-0000-4000-8000-000000000267'::uuid, 'read_project'),
        ('00000000-0000-4000-8000-000000000270'::uuid, '00000000-0000-4000-8000-000000000268'::uuid, 'read_project');
      INSERT INTO "project_memberships" ("id","project_id","user_id","role_id") VALUES
        ('00000000-0000-4000-8000-000000000271'::uuid, '${aliceProjectId}'::uuid, '${aliceId}'::uuid, '00000000-0000-4000-8000-000000000267'::uuid),
        ('00000000-0000-4000-8000-000000000272'::uuid, '${sharedProjectId}'::uuid, '${aliceId}'::uuid, '00000000-0000-4000-8000-000000000268'::uuid),
        ('00000000-0000-4000-8000-000000000273'::uuid, '${sharedProjectId}'::uuid, '${bobId}'::uuid, '00000000-0000-4000-8000-000000000268'::uuid);
      INSERT INTO "screenplays" ("id","owner_user_id","title","filename","created_at","updated_at") VALUES
        ('${bobScreenplayId}'::uuid, '${bobId}'::uuid, 'Bob private screenplay', 'bob-private.fountain', now(), now()),
        ('${sharedScreenplayId}'::uuid, '${bobId}'::uuid, 'Shared screenplay', 'shared.fountain', now(), now());
      INSERT INTO "screenplay_roles" ("id","screenplay_id","name","position") VALUES
        ('00000000-0000-4000-8000-000000000274'::uuid, '${bobScreenplayId}'::uuid, 'snapshot-reader', 'a'),
        ('00000000-0000-4000-8000-000000000275'::uuid, '${sharedScreenplayId}'::uuid, 'snapshot-reader', 'a');
      INSERT INTO "screenplay_role_permissions" ("id","role_id","permission") VALUES
        ('00000000-0000-4000-8000-000000000276'::uuid, '00000000-0000-4000-8000-000000000274'::uuid, 'read_screenplay'),
        ('00000000-0000-4000-8000-000000000277'::uuid, '00000000-0000-4000-8000-000000000275'::uuid, 'read_screenplay');
      INSERT INTO "screenplay_memberships" ("id","screenplay_id","user_id","role_id") VALUES
        ('00000000-0000-4000-8000-000000000278'::uuid, '${bobScreenplayId}'::uuid, '${bobId}'::uuid, '00000000-0000-4000-8000-000000000274'::uuid),
        ('00000000-0000-4000-8000-000000000279'::uuid, '${sharedScreenplayId}'::uuid, '${aliceId}'::uuid, '00000000-0000-4000-8000-000000000275'::uuid),
        ('00000000-0000-4000-8000-000000000280'::uuid, '${sharedScreenplayId}'::uuid, '${bobId}'::uuid, '00000000-0000-4000-8000-000000000275'::uuid);
    `);

    try {
      const before = snapshot(false);
      runDatabaseScript(migrationSql());
      const after = snapshot(true);
      expect(
        queryDatabase(
          `SELECT count(*) FROM "space_memberships" WHERE "space_id" = '${DEFAULT_SPACE_ID}'::uuid`,
        ),
        'Default Space membership widens upgrade reach; the Spaces migration must seed zero memberships',
      ).toBe('0');
      expect(
        after,
        'Additive Space reach changed an upgrade snapshot; the migration likely seeded Space reach',
      ).toEqual(before);
    } finally {
      cleanup();
    }
  }, 120_000);
});
