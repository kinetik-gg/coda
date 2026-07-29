import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    'prisma/migrations/20260730000000_project_user_workspace_layouts/migration.sql',
  ),
  'utf8',
);

describe('project user workspace layouts migration', () => {
  it('is additive and replay-safe after an N-1 restore', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "project_user_workspace_layouts"',
    );
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "project_user_workspace_layouts_user_id_idx"',
    );
    expect(migration).toContain('ON CONFLICT ("project_id", "user_id") DO UPDATE SET');
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\b/u);
  });

  it('keeps the appended table independent from core project and user constraints', () => {
    const createTable = migration.slice(
      migration.indexOf('CREATE TABLE'),
      migration.indexOf('CREATE INDEX'),
    );
    expect(createTable).not.toContain('REFERENCES "projects"');
    expect(createTable).not.toContain('REFERENCES "users"');
  });

  it('backfills the durable identity from every legacy direct-member layout', () => {
    expect(migration).toContain('FROM "project_membership_workspace_layouts" personal');
    expect(migration).toContain(
      'JOIN "project_memberships" membership ON membership."id" = personal."membership_id"',
    );
  });
});
