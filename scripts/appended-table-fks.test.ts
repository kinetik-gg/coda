import { describe, expect, it } from 'vitest';

import {
  checkMigrationStatement,
  checkSchemaRelations,
  checkSchemaTypes,
  formatViolations,
  parsePrismaEnums,
  parsePrismaModels,
  splitClauses,
  splitStatements,
  type Violation,
} from './appended-table-fks';

/**
 * Pins the parsing behind the appended-table backup-compatibility gate (issue #265).
 *
 * Two properties matter equally and are both covered here: the gate must FLAG a foreign key or
 * shared type that an appended table takes onto a core table, and it must stay SILENT on the
 * shapes the repository legitimately contains (core-to-core edges, foreign keys among appended
 * tables, base-typed columns). A gate that cries wolf gets disabled, so the silence cases are the
 * load-bearing ones.
 */

const ENUMS = new Set(['InvitationStatus']);

function migrationViolations(sql: string): Violation[] {
  const violations: Violation[] = [];
  for (const statement of splitStatements(sql)) {
    checkMigrationStatement(statement, 'migration.sql', ENUMS, violations);
  }
  return violations;
}

function schemaViolations(schema: string): Violation[] {
  const violations: Violation[] = [];
  const models = parsePrismaModels(schema);
  checkSchemaRelations(models, violations);
  checkSchemaTypes(models, parsePrismaEnums(schema), violations);
  return violations;
}

describe('statement splitting', () => {
  it('keeps a dollar-quoted function body in one statement', () => {
    const statements = splitStatements(
      `CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n` +
        `  RAISE EXCEPTION 'no; really';\nEND;\n$$;\nCREATE TABLE "t" ("id" UUID);`,
    );
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('CREATE TABLE "t"');
  });

  it('drops line comments so commented-out DDL is never flagged', () => {
    expect(
      migrationViolations('-- REFERENCES "users"("id")\nCREATE TABLE "t" ("id" UUID);'),
    ).toEqual([]);
  });

  it('splits clauses at top level only, ignoring commas inside parentheses', () => {
    expect(
      splitClauses('"a" VARCHAR(10), FOREIGN KEY ("b", "c") REFERENCES "d"("e", "f")'),
    ).toEqual(['"a" VARCHAR(10)', 'FOREIGN KEY ("b", "c") REFERENCES "d"("e", "f")']);
  });
});

describe('migration DDL', () => {
  it('flags an inline foreign key onto a core table', () => {
    const violations = migrationViolations(
      'CREATE TABLE "widget_notes" (\n  "id" UUID NOT NULL,\n' +
        '  "screenplay_id" UUID NOT NULL REFERENCES "screenplays"("id") ON DELETE CASCADE\n);',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('widget_notes(screenplay_id) -> screenplays');
  });

  it('flags a hand-written ALTER TABLE foreign key that no Prisma relation declares', () => {
    const violations = migrationViolations(
      'ALTER TABLE "widget_notes" ADD CONSTRAINT "widget_notes_user_fkey" ' +
        'FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('widget_notes(user_id) -> users');
  });

  it('flags a composite foreign key onto a core table', () => {
    const violations = migrationViolations(
      'ALTER TABLE "widget_notes" ADD CONSTRAINT "c" FOREIGN KEY ("screenplay_id", "owner_user_id") ' +
        'REFERENCES "screenplays"("id", "owner_user_id");',
    );
    expect(violations[0]?.detail).toContain(
      'widget_notes(screenplay_id, owner_user_id) -> screenplays',
    );
  });

  it('flags citext and shared enum columns in an appended table', () => {
    const violations = migrationViolations(
      'CREATE TABLE IF NOT EXISTS "widget_notes" (\n  "email" CITEXT NOT NULL,\n' +
        '  "status" "InvitationStatus" NOT NULL\n);',
    );
    expect(violations.map((entry) => entry.detail)).toEqual([
      expect.stringContaining('widget_notes.email : citext'),
      expect.stringContaining('widget_notes.status : InvitationStatus'),
    ]);
  });

  it('flags a shared enum added by ALTER TABLE ADD COLUMN', () => {
    const violations = migrationViolations(
      'ALTER TABLE "widget_notes" ADD COLUMN IF NOT EXISTS "status" "InvitationStatus";',
    );
    expect(violations[0]?.detail).toContain('widget_notes.status : InvitationStatus');
  });

  it('stays silent on foreign keys among appended tables and on base types', () => {
    expect(
      migrationViolations(
        'CREATE TABLE "widget_notes" (\n  "id" UUID NOT NULL,\n' +
          '  "role_id" UUID NOT NULL REFERENCES "widget_roles"("id") ON DELETE CASCADE,\n' +
          '  "email" TEXT NOT NULL,\n  "status" VARCHAR(20) NOT NULL DEFAULT \'PENDING\',\n' +
          '  CONSTRAINT "widget_notes_pkey" PRIMARY KEY ("id")\n);\n' +
          'CREATE INDEX "widget_notes_idx" ON "widget_notes"("role_id");',
      ),
    ).toEqual([]);
  });

  it('stays silent on the allowlisted core-to-core edges the repository really contains', () => {
    expect(
      migrationViolations(
        'CREATE TABLE "sessions" (\n  "user_id" UUID NOT NULL REFERENCES "users"("id")\n);\n' +
          'ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_project_id_fkey" ' +
          'FOREIGN KEY ("project_id") REFERENCES "projects"("id");',
      ),
    ).toEqual([]);
  });
});

describe('schema.prisma', () => {
  const appended = (extra: string): string =>
    `enum InvitationStatus {\n  PENDING\n}\n\n` +
    `model Screenplay {\n  id String @id\n\n  @@map("screenplays")\n}\n\n` +
    `model WidgetNote {\n  id String @id\n  screenplayId String @map("screenplay_id")\n${extra}\n` +
    `  @@map("widget_notes")\n}\n`;

  it('flags a relation field onto a core table', () => {
    const violations = schemaViolations(
      appended('  screenplay Screenplay @relation(fields: [screenplayId], references: [id])\n'),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('widget_notes(screenplay_id) -> screenplays');
  });

  it('flags citext and shared enum fields', () => {
    const violations = schemaViolations(
      appended('  email String @db.Citext\n  status InvitationStatus\n'),
    );
    expect(violations.map((entry) => entry.detail)).toEqual([
      expect.stringContaining('widget_notes.email : citext'),
      expect.stringContaining('widget_notes.status : InvitationStatus'),
    ]);
  });

  it('stays silent on plain scalar columns and base types', () => {
    expect(
      schemaViolations(appended('  email String @db.Text\n  status String @db.VarChar(20)\n')),
    ).toEqual([]);
  });

  it('ignores commented-out relation fields', () => {
    expect(
      schemaViolations(
        appended(
          '  // screenplay Screenplay @relation(fields: [screenplayId], references: [id])\n',
        ),
      ),
    ).toEqual([]);
  });
});

describe('formatViolations', () => {
  it('prints one indented detail line per violation', () => {
    expect(formatViolations([{ location: 'a.sql', detail: 'bad' }])).toBe('a.sql\n    bad');
  });
});
