import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseReachable, queryDatabase, runDatabaseScript } from './support/postgres';

/**
 * The equivalence gate for issue #238.
 *
 * `breakdown_screenplay_links` is a sidecar table with no foreign key onto `projects`,
 * `screenplays`, or `users`, so nothing in the database forces the pre-existing PDF
 * source-reference graph to stay intact when a breakdown starts (or stops) following a screenplay.
 * This test pins that invariant directly: it snapshots the ordered resolution of every
 * `ItemSourceReference` in a seeded breakdown, applies the real migration SQL twice (the second run
 * models replay after an N-1 `pg_restore`, because `_prisma_migrations` travels inside the dump),
 * links and then unlinks a screenplay, and requires the snapshot to be deeply identical each time.
 *
 * Deliberately uses only `support/postgres.ts`. This lane drives a containerised app and never runs
 * `prisma generate` in the runner's context, so importing `PrismaService` here would fail.
 */

const ownerId = '00000000-0000-4000-8000-000000000381';
const projectId = '00000000-0000-4000-8000-000000000382';
const screenplayId = '00000000-0000-4000-8000-000000000383';
const otherScreenplayId = '00000000-0000-4000-8000-000000000384';
const entityTypeId = '00000000-0000-4000-8000-000000000385';
const storageObjectId = '00000000-0000-4000-8000-000000000386';
const sourceDocumentId = '00000000-0000-4000-8000-000000000387';
const firstItemId = '00000000-0000-4000-8000-000000000388';
const secondItemId = '00000000-0000-4000-8000-000000000389';
const referenceIds = [
  '00000000-0000-4000-8000-000000000390',
  '00000000-0000-4000-8000-000000000391',
  '00000000-0000-4000-8000-000000000392',
];

const migrationSql = (): string =>
  readFileSync(
    resolve('apps/api/prisma/migrations/20260730010000_breakdown_screenplay_links/migration.sql'),
    'utf8',
  );

/**
 * The ordered resolution of every source reference in the breakdown, exactly as the existing read
 * path walks it: reference -> source document -> storage object. Ordered by item then `position`
 * so a reordering would show up as a difference rather than being sorted away.
 */
function resolutionSnapshot(): unknown {
  const raw = queryDatabase(`
    SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'item', entry->>'position'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'reference', reference."id",
        'item', reference."item_id",
        'sourceDocument', reference."source_document_id",
        'storageObject', document."storage_object_id",
        'objectKey', object."object_key",
        'startPage', reference."start_page",
        'endPage', reference."end_page",
        'position', reference."position",
        'documentTrashed', (document."deleted_at" IS NOT NULL)
      ) AS entry
      FROM "item_source_references" reference
      JOIN "breakdown_items" item ON item."id" = reference."item_id"
      JOIN "source_documents" document ON document."id" = reference."source_document_id"
      JOIN "storage_objects" object ON object."id" = document."storage_object_id"
      WHERE item."project_id" = '${projectId}'::uuid
    ) resolved;
  `);
  return JSON.parse(raw);
}

function linkCount(): string {
  return queryDatabase(
    `SELECT count(*) FROM "breakdown_screenplay_links" WHERE "project_id" = '${projectId}'::uuid`,
  );
}

function cleanup(): void {
  runDatabaseScript(`
    DELETE FROM "breakdown_screenplay_links" WHERE "project_id" = '${projectId}'::uuid;
    DELETE FROM "item_source_references" WHERE "id" IN (${referenceIds
      .map((id) => `'${id}'::uuid`)
      .join(', ')});
    DELETE FROM "source_documents" WHERE "id" = '${sourceDocumentId}'::uuid;
    DELETE FROM "storage_objects" WHERE "id" = '${storageObjectId}'::uuid;
    DELETE FROM "breakdown_items" WHERE "project_id" = '${projectId}'::uuid;
    DELETE FROM "entity_types" WHERE "project_id" = '${projectId}'::uuid;
    DELETE FROM "projects" WHERE "id" = '${projectId}'::uuid;
    DELETE FROM "screenplays" WHERE "id" IN ('${screenplayId}'::uuid, '${otherScreenplayId}'::uuid);
    DELETE FROM "users" WHERE "id" = '${ownerId}'::uuid;
  `);
}

function seed(): void {
  runDatabaseScript(`
    INSERT INTO "users" ("id","email","display_name","password_hash","created_at","updated_at")
      VALUES ('${ownerId}'::uuid, 'breakdown-link-owner@coda.local', 'Link Owner', 'not-a-login-credential', now(), now());
    INSERT INTO "projects" ("id","owner_user_id","name","created_at","updated_at")
      VALUES ('${projectId}'::uuid, '${ownerId}'::uuid, 'Link equivalence breakdown', now(), now());
    INSERT INTO "screenplays" ("id","owner_user_id","title","filename","created_at","updated_at") VALUES
      ('${screenplayId}'::uuid, '${ownerId}'::uuid, 'Linked screenplay', 'linked.fountain', now(), now()),
      ('${otherScreenplayId}'::uuid, '${ownerId}'::uuid, 'Replacement screenplay', 'replacement.fountain', now(), now());
    INSERT INTO "entity_types" ("id","project_id","singular_name","plural_name","level","position")
      VALUES ('${entityTypeId}'::uuid, '${projectId}'::uuid, 'Scene', 'Scenes', 1, 'a');
    INSERT INTO "breakdown_items" ("id","project_id","entity_type_id","title","position","created_at","updated_at") VALUES
      ('${firstItemId}'::uuid, '${projectId}'::uuid, '${entityTypeId}'::uuid, 'Cold open', 'a', now(), now()),
      ('${secondItemId}'::uuid, '${projectId}'::uuid, '${entityTypeId}'::uuid, 'Rooftop chase', 'b', now(), now());
    INSERT INTO "storage_objects" ("id","project_id","kind","status","object_key","original_filename","mime_type","size_bytes","created_at")
      VALUES ('${storageObjectId}'::uuid, '${projectId}'::uuid, 'SOURCE_DOCUMENT', 'READY', 'link-equivalence/script.pdf', 'script.pdf', 'application/pdf', 4096, now());
    INSERT INTO "source_documents" ("id","project_id","storage_object_id","title","page_count","created_at")
      VALUES ('${sourceDocumentId}'::uuid, '${projectId}'::uuid, '${storageObjectId}'::uuid, 'Shooting script', 120, now());
    -- Two ordered references on one item plus a multi-page reference on another: enough shape that
    -- a dropped row, a reordering, or a rewritten page range all show up as a snapshot difference.
    INSERT INTO "item_source_references" ("id","item_id","source_document_id","start_page","end_page","position") VALUES
      ('${referenceIds[0]}'::uuid, '${firstItemId}'::uuid, '${sourceDocumentId}'::uuid, 1, 1, 'a'),
      ('${referenceIds[1]}'::uuid, '${firstItemId}'::uuid, '${sourceDocumentId}'::uuid, 4, 9, 'b'),
      ('${referenceIds[2]}'::uuid, '${secondItemId}'::uuid, '${sourceDocumentId}'::uuid, 12, 12, 'a');
  `);
}

describe.runIf(databaseReachable())('Breakdown screenplay link equivalence', () => {
  it('resolves every pre-existing source reference identically across migration replay, link, and unlink', () => {
    cleanup();
    seed();

    try {
      const before = resolutionSnapshot();
      expect(before, 'The fixture must produce three resolved references').toHaveLength(3);

      // Replay the real migration twice. The first run is the ordinary upgrade; the second models
      // an N-1 restore that brought its own `_prisma_migrations` back, so the file runs again.
      runDatabaseScript(migrationSql());
      runDatabaseScript(migrationSql());
      expect(
        linkCount(),
        'The migration must infer no link: no legacy row carries a screenplay identity',
      ).toBe('0');
      expect(
        resolutionSnapshot(),
        'Applying the expand migration changed how an existing source reference resolves',
      ).toEqual(before);

      runDatabaseScript(`
        INSERT INTO "breakdown_screenplay_links"
          ("project_id","screenplay_id","created_by_id","updated_by_id","created_at","updated_at")
        VALUES ('${projectId}'::uuid, '${screenplayId}'::uuid, '${ownerId}'::uuid, '${ownerId}'::uuid, now(), now());
      `);
      expect(linkCount()).toBe('1');
      expect(
        resolutionSnapshot(),
        'Linking a screenplay changed how an existing PDF source reference resolves',
      ).toEqual(before);

      // Re-linking must replace in place: one screenplay per breakdown is the chosen cardinality.
      runDatabaseScript(`
        INSERT INTO "breakdown_screenplay_links"
          ("project_id","screenplay_id","created_by_id","updated_by_id","created_at","updated_at")
        VALUES ('${projectId}'::uuid, '${otherScreenplayId}'::uuid, '${ownerId}'::uuid, '${ownerId}'::uuid, now(), now())
        ON CONFLICT ("project_id") DO UPDATE SET "screenplay_id" = EXCLUDED."screenplay_id";
      `);
      expect(linkCount(), 'A second link row would break one-screenplay-per-breakdown').toBe('1');
      expect(
        resolutionSnapshot(),
        'Replacing the linked screenplay changed how an existing source reference resolves',
      ).toEqual(before);

      runDatabaseScript(
        `DELETE FROM "breakdown_screenplay_links" WHERE "project_id" = '${projectId}'::uuid;`,
      );
      expect(
        resolutionSnapshot(),
        'Unlinking a screenplay changed how an existing PDF source reference resolves',
      ).toEqual(before);
    } finally {
      cleanup();
    }
  }, 120_000);

  it('has no database-level protection against an orphaned link, so purge order is load-bearing', () => {
    cleanup();
    seed();
    runDatabaseScript(migrationSql());

    try {
      expect(
        queryDatabase(`
          SELECT count(*) FROM "information_schema"."table_constraints"
          WHERE "table_name" = 'breakdown_screenplay_links' AND "constraint_type" = 'FOREIGN KEY'
        `),
        'A foreign key here would break pg_restore --clean of an N-1 backup',
      ).toBe('0');

      runDatabaseScript(`
        INSERT INTO "breakdown_screenplay_links"
          ("project_id","screenplay_id","created_by_id","updated_by_id","created_at","updated_at")
        VALUES ('${projectId}'::uuid, '${otherScreenplayId}'::uuid, '${ownerId}'::uuid, '${ownerId}'::uuid, now(), now());
        DELETE FROM "screenplays" WHERE "id" = '${otherScreenplayId}'::uuid;
      `);
      // Nothing stopped the screenplay from going away underneath its link, and nothing cascaded.
      // That is the whole reason `trash-screenplay.ts` and `trash-project-purger.ts` must delete
      // link rows explicitly, and why every read re-validates the plain screenplay id.
      expect(
        linkCount(),
        'Deleting a screenplay must be able to strand a link row; if it cannot, the table grew a ' +
          'foreign key and the N-1 restore convention is broken',
      ).toBe('1');

      // The purge order the application actually uses: link rows first, then the screenplay.
      runDatabaseScript(`
        DELETE FROM "breakdown_screenplay_links" WHERE "screenplay_id" = '${screenplayId}'::uuid;
        DELETE FROM "screenplays" WHERE "id" = '${screenplayId}'::uuid;
        DELETE FROM "breakdown_screenplay_links" WHERE "project_id" = '${projectId}'::uuid;
      `);
      expect(linkCount(), 'Purging a screenplay must leave no orphaned link row').toBe('0');
      expect(
        resolutionSnapshot(),
        'Purging a linked screenplay must not disturb the breakdown PDF references',
      ).toHaveLength(3);
    } finally {
      cleanup();
    }
  }, 120_000);
});
