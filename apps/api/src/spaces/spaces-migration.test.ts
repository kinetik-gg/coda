import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(__dirname, '../../prisma/migrations/20260728000000_spaces/migration.sql'),
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

  it('inserts no memberships and has no dependency on a core table or shared invitation type', () => {
    expect(migration.match(/INSERT INTO "space_memberships"/gu) ?? []).toHaveLength(0);
    expect(seedSource).toContain("name: 'Default'");
    expect(seedSource).toContain('id: DEFAULT_SPACE_ID');
    expect(seedSource).not.toMatch(/spaceMembership\.(?:create|createMany|upsert)/u);
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
});
