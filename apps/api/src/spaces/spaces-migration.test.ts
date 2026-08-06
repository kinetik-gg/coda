import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(__dirname, '../../prisma/migrations/20260728000000_spaces/migration.sql'),
  'utf8',
);
const personalDefaultsMigration = readFileSync(
  join(__dirname, '../../prisma/migrations/20260806000000_personal_default_spaces/migration.sql'),
  'utf8',
);
const seedSource = readFileSync(join(__dirname, '../../prisma/seed-database.ts'), 'utf8');
const mainSource = readFileSync(join(__dirname, '../main.ts'), 'utf8');

describe('Spaces migration safety contract', () => {
  it('keeps every appended table and index replay-safe', () => {
    const tables = [
      'spaces',
      'space_resources',
      'space_roles',
      'space_role_permissions',
      'space_memberships',
      'space_invitations',
    ];
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    const indexStatements = migration.match(/CREATE (?:UNIQUE )?INDEX[\s\S]*?;/gu) ?? [];
    expect(indexStatements.length).toBeGreaterThan(0);
    expect(indexStatements.every((statement) => statement.includes('IF NOT EXISTS'))).toBe(true);
    const insertStatements = migration.match(/INSERT INTO[\s\S]*?;/gu) ?? [];
    expect(insertStatements).toHaveLength(5);
    expect(insertStatements.every((statement) => statement.includes('ON CONFLICT'))).toBe(true);
  });

  it('keeps the historical expansion free of core foreign keys and shared invitation types', () => {
    expect(migration.match(/INSERT INTO "space_memberships"/gu) ?? []).toHaveLength(0);
    expect(seedSource).toContain('ensurePersonalDefaultSpace(tx, ownerUserId)');
    expect(seedSource).toContain('spaceResource.create');
    expect(migration).not.toMatch(/REFERENCES "(?:users|projects|screenplays)"/u);
    expect(migration).toContain('"email" TEXT NOT NULL');
    expect(migration).toContain('"status" VARCHAR(20) NOT NULL');
    expect(migration).not.toContain('"InvitationStatus"');
  });

  it('uses the fixed Default id and maps projects and screenplays without filtering deleted rows', () => {
    expect(migration).toContain('00000000-0000-4000-8000-000000000001');
    const resourceInserts = migration.match(
      /INSERT INTO "space_resources"[\s\S]*?ON CONFLICT \("resource_type", "resource_id"\) DO NOTHING;/gu,
    );
    expect(resourceInserts).toHaveLength(2);
    expect(resourceInserts?.[0]).toContain('FROM "projects" p');
    expect(resourceInserts?.[1]).toContain('FROM "screenplays" s');
    expect(resourceInserts?.every((statement) => !statement.includes('"deleted_at"'))).toBe(true);
  });

  it('runs reconciliation before the HTTP listener accepts traffic', () => {
    const reconcileAt = mainSource.indexOf('SpaceResourceReconciler).reconcile()');
    const listenAt = mainSource.indexOf('app.listen(');
    expect(reconcileAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(reconcileAt);
  });

  it('corrects the global Default to one ordinary owned Default per user', () => {
    expect(personalDefaultsMigration).toContain('DROP INDEX IF EXISTS "spaces_single_default"');
    expect(personalDefaultsMigration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "spaces_one_default_per_owner"',
    );
    expect(personalDefaultsMigration).toContain('FROM "users" u');
    expect(personalDefaultsMigration).toContain(
      'INSERT INTO "space_memberships" ("space_id", "user_id", "role_id")',
    );
    expect(personalDefaultsMigration).toContain('personal."owner_user_id" = p."owner_user_id"');
    expect(personalDefaultsMigration).toContain(
      'personal."owner_user_id" = screenplay."owner_user_id"',
    );
    expect(personalDefaultsMigration).toContain('SET "is_default" = FALSE');
  });
});
