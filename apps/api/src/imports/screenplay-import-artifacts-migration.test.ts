import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('prisma/migrations/20260730010000_screenplay_import_artifacts/migration.sql'),
  'utf8',
);

describe('screenplay import artifacts migration', () => {
  it('is additive and replay-safe after an N-1 restore', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "screenplay_import_artifacts"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS');
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\b/u);
  });

  it('does not depend on core constraints or shared types', () => {
    expect(migration).not.toContain('REFERENCES "screenplays"');
    expect(migration).not.toContain('REFERENCES "users"');
    expect(migration).not.toContain('REFERENCES "projects"');
    expect(migration).not.toContain('"StorageStatus"');
    expect(migration).not.toContain('CITEXT');
  });

  it('requires complete evidence only for ready artifacts', () => {
    expect(migration).toContain(`"status" IN ('PENDING', 'READY', 'FAILED')`);
    expect(migration).toContain(`"status" = 'READY'`);
    expect(migration).toContain(
      `("conversion_report"->>'schemaVersion')::INTEGER = "report_schema_version"`,
    );
  });
});
