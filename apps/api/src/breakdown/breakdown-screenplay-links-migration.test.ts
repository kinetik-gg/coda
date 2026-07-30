import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('prisma/migrations/20260730010000_breakdown_screenplay_links/migration.sql'),
  'utf8',
);

const postgresSchema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
const sqliteSchema = readFileSync(resolve('prisma/schema.sqlite.prisma'), 'utf8');

describe('breakdown screenplay links migration', () => {
  it('is additive and replay-safe after an N-1 restore', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "breakdown_screenplay_links"');
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "breakdown_screenplay_links_screenplay_id_idx"',
    );
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\b/u);
  });

  it('seeds no inferred link, because no legacy row can name a screenplay', () => {
    // The audit behind epic #236 established that an existing ItemSourceReference carries no
    // screenplay identity at all, so any backfill here would be a guess.
    expect(migration).not.toMatch(/\bINSERT\b/u);
  });

  it('keeps the appended table independent from core project, screenplay, and user constraints', () => {
    expect(migration).not.toContain('REFERENCES "projects"');
    expect(migration).not.toContain('REFERENCES "screenplays"');
    expect(migration).not.toContain('REFERENCES "users"');
    expect(migration).not.toContain('FOREIGN KEY');
  });

  it('enforces one screenplay per breakdown through the primary key', () => {
    expect(migration).toContain(
      'CONSTRAINT "breakdown_screenplay_links_pkey" PRIMARY KEY ("project_id")',
    );
  });
});

describe('breakdown screenplay link model', () => {
  function model(schema: string): string {
    const start = schema.indexOf('model BreakdownScreenplayLink {');
    expect(start, 'BreakdownScreenplayLink must exist in both Prisma schemas').toBeGreaterThan(-1);
    return schema.slice(start, schema.indexOf('}', start));
  }

  it.each([
    ['postgres', postgresSchema],
    ['sqlite', sqliteSchema],
  ])('declares no relation onto a core aggregate in the %s schema', (_lane, schema) => {
    const declaration = model(schema);
    expect(declaration).toContain('@@map("breakdown_screenplay_links")');
    expect(declaration).not.toContain('@relation');
    expect(declaration).not.toMatch(/\b(?:Project|Screenplay|User)\b/u);
  });

  it('leaves the breakdown source-reference graph untouched', () => {
    const reference = postgresSchema.slice(
      postgresSchema.indexOf('model ItemSourceReference {'),
      postgresSchema.indexOf('}', postgresSchema.indexOf('model ItemSourceReference {')),
    );
    expect(reference).not.toContain('screenplay');
    expect(reference).not.toContain('BreakdownScreenplayLink');
  });
});
