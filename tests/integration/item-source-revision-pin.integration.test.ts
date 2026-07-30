import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseReachable, queryDatabase, runDatabaseScript } from './support/postgres';

/**
 * The equivalence and pinned-stability gate for issue #239.
 *
 * `item_source_revision_pins` is a sidecar with no foreign key onto `item_source_references`,
 * `breakdown_items`, `projects`, `screenplays`, `screenplay_revisions`, or `users`, so nothing in
 * the database forces either half of the acceptance criterion. This test pins both halves directly:
 *
 * 1. every pre-existing PDF-only reference resolves byte-for-byte identically across migration
 *    replay, pinning a *different* reference, and unpinning; and
 * 2. once a reference is pinned, advancing the mutable screenplay — the way a REST update does, and
 *    the way the collaboration projection does — leaves it resolving to the exact text and range in
 *    its stored `ScreenplayRevision.id`.
 *
 * Deliberately uses only `support/postgres.ts`. This lane drives a containerised app and never runs
 * `prisma generate` in the runner's context, so importing `PrismaService` here would fail.
 */

const ownerId = '00000000-0000-4000-8000-0000000004a1';
const projectId = '00000000-0000-4000-8000-0000000004a2';
const screenplayId = '00000000-0000-4000-8000-0000000004a3';
const revisionId = '00000000-0000-4000-8000-0000000004a4';
const laterRevisionId = '00000000-0000-4000-8000-0000000004a5';
const entityTypeId = '00000000-0000-4000-8000-0000000004a6';
const storageObjectId = '00000000-0000-4000-8000-0000000004a7';
const sourceDocumentId = '00000000-0000-4000-8000-0000000004a8';
const firstItemId = '00000000-0000-4000-8000-0000000004a9';
const secondItemId = '00000000-0000-4000-8000-0000000004aa';
const referenceIds = [
  '00000000-0000-4000-8000-0000000004ab',
  '00000000-0000-4000-8000-0000000004ac',
  '00000000-0000-4000-8000-0000000004ad',
];

/**
 * The screenplay text the pin is taken from. Non-ASCII on purpose: the range is UTF-16 code units,
 * so a byte-offset confusion anywhere in the stack would slice the wrong text here.
 */
const pinnedSource = 'INT. CAFÉ - NIGHT\n\nMAYA sets down the envelope.\n';
const pinnedRange = { start: 19, end: 47 };
const pinnedExcerpt = pinnedSource.slice(pinnedRange.start, pinnedRange.end);
const pinnedHash = createHash('sha256').update(pinnedExcerpt, 'utf8').digest('hex');

/** The text the mutable screenplay is advanced to. It must never leak into a pinned resolution. */
const rewrittenSource = 'EXT. ROOFTOP - DAWN\n\nMAYA burns the envelope instead.\n';

const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const utf8Length = (value: string): number => Buffer.byteLength(value, 'utf8');

const migrationSql = (): string =>
  readFileSync(
    resolve('apps/api/prisma/migrations/20260730020000_item_source_revision_pins/migration.sql'),
    'utf8',
  );

/**
 * The ordered legacy resolution of every source reference in the breakdown, exactly as the
 * pre-#239 read path walks it: reference -> source document -> storage object. This snapshot must
 * not move for any reason, including for the reference that later gains a pin.
 */
function legacySnapshot(): unknown {
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
        'position', reference."position"
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

/**
 * Resolution through the pin: the excerpt comes out of `screenplay_revisions`, never out of
 * `screenplays`. That single join is the acceptance criterion, expressed in SQL.
 */
function pinnedSnapshot(): unknown {
  const raw = queryDatabase(`
    SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'reference'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'reference', pin."item_source_reference_id",
        'revision', pin."screenplay_revision_id",
        'pinnedVersion', pin."screenplay_version",
        'start', pin."source_start",
        'end', pin."source_end",
        'hash', pin."source_text_hash",
        'excerpt', substring(revision."source_text" from pin."source_start" + 1
                             for pin."source_end" - pin."source_start"),
        -- The legacy fields the pin must never disturb.
        'sourceDocument', reference."source_document_id",
        'startPage', reference."start_page",
        'endPage', reference."end_page"
      ) AS entry
      FROM "item_source_revision_pins" pin
      JOIN "item_source_references" reference ON reference."id" = pin."item_source_reference_id"
      JOIN "screenplay_revisions" revision ON revision."id" = pin."screenplay_revision_id"
      WHERE pin."project_id" = '${projectId}'::uuid
    ) resolved;
  `);
  return JSON.parse(raw);
}

function pinCount(): string {
  return queryDatabase(
    `SELECT count(*) FROM "item_source_revision_pins" WHERE "project_id" = '${projectId}'::uuid`,
  );
}

function cleanup(): void {
  runDatabaseScript(`
    DELETE FROM "item_source_revision_pins" WHERE "project_id" = '${projectId}'::uuid;
    DELETE FROM "breakdown_screenplay_links" WHERE "project_id" = '${projectId}'::uuid;
    DELETE FROM "item_source_references" WHERE "id" IN (${referenceIds
      .map((id) => `'${id}'::uuid`)
      .join(', ')});
    DELETE FROM "source_documents" WHERE "id" = '${sourceDocumentId}'::uuid;
    DELETE FROM "storage_objects" WHERE "id" = '${storageObjectId}'::uuid;
    DELETE FROM "breakdown_items" WHERE "project_id" = '${projectId}'::uuid;
    DELETE FROM "entity_types" WHERE "project_id" = '${projectId}'::uuid;
    DELETE FROM "projects" WHERE "id" = '${projectId}'::uuid;
    DELETE FROM "screenplay_revisions" WHERE "screenplay_id" = '${screenplayId}'::uuid;
    DELETE FROM "screenplays" WHERE "id" = '${screenplayId}'::uuid;
    DELETE FROM "users" WHERE "id" = '${ownerId}'::uuid;
  `);
}

function seed(): void {
  runDatabaseScript(`
    INSERT INTO "users" ("id","email","display_name","password_hash","created_at","updated_at")
      VALUES ('${ownerId}'::uuid, 'revision-pin-owner@coda.local', 'Pin Owner', 'not-a-login-credential', now(), now());
    INSERT INTO "projects" ("id","owner_user_id","name","created_at","updated_at")
      VALUES ('${projectId}'::uuid, '${ownerId}'::uuid, 'Pin equivalence breakdown', now(), now());
    INSERT INTO "screenplays"
      ("id","owner_user_id","title","filename","source_text","source_byte_length","version","created_at","updated_at")
      VALUES ('${screenplayId}'::uuid, '${ownerId}'::uuid, 'Pinned screenplay', 'pinned.fountain',
              ${sqlLiteral(pinnedSource)}, ${utf8Length(pinnedSource)}, 7, now(), now());
    INSERT INTO "entity_types" ("id","project_id","singular_name","plural_name","level","position")
      VALUES ('${entityTypeId}'::uuid, '${projectId}'::uuid, 'Scene', 'Scenes', 1, 'a');
    INSERT INTO "breakdown_items" ("id","project_id","entity_type_id","title","position","created_at","updated_at") VALUES
      ('${firstItemId}'::uuid, '${projectId}'::uuid, '${entityTypeId}'::uuid, 'Cold open', 'a', now(), now()),
      ('${secondItemId}'::uuid, '${projectId}'::uuid, '${entityTypeId}'::uuid, 'Rooftop chase', 'b', now(), now());
    INSERT INTO "storage_objects" ("id","project_id","kind","status","object_key","original_filename","mime_type","size_bytes","created_at")
      VALUES ('${storageObjectId}'::uuid, '${projectId}'::uuid, 'SOURCE_DOCUMENT', 'READY', 'pin-equivalence/script.pdf', 'script.pdf', 'application/pdf', 4096, now());
    INSERT INTO "source_documents" ("id","project_id","storage_object_id","title","page_count","created_at")
      VALUES ('${sourceDocumentId}'::uuid, '${projectId}'::uuid, '${storageObjectId}'::uuid, 'Shooting script', 120, now());
    -- Two ordered references on one item plus a multi-page reference on another. Only the middle one
    -- is ever pinned, so the other two stay legacy rows for the whole test.
    INSERT INTO "item_source_references" ("id","item_id","source_document_id","start_page","end_page","position") VALUES
      ('${referenceIds[0]}'::uuid, '${firstItemId}'::uuid, '${sourceDocumentId}'::uuid, 1, 1, 'a'),
      ('${referenceIds[1]}'::uuid, '${firstItemId}'::uuid, '${sourceDocumentId}'::uuid, 4, 9, 'b'),
      ('${referenceIds[2]}'::uuid, '${secondItemId}'::uuid, '${sourceDocumentId}'::uuid, 12, 12, 'a');
  `);
}

/** The immutable snapshot the pin will name, plus the breakdown's link to its screenplay. */
function checkpointAndLink(): void {
  runDatabaseScript(`
    INSERT INTO "screenplay_revisions"
      ("id","screenplay_id","owner_user_id","screenplay_version","filename","paper_size","source_text","source_byte_length","created_at")
      VALUES ('${revisionId}'::uuid, '${screenplayId}'::uuid, '${ownerId}'::uuid, 7, 'pinned.fountain', 'letter',
              ${sqlLiteral(pinnedSource)}, ${utf8Length(pinnedSource)}, now());
    INSERT INTO "breakdown_screenplay_links"
      ("project_id","screenplay_id","created_by_id","updated_by_id","created_at","updated_at")
      VALUES ('${projectId}'::uuid, '${screenplayId}'::uuid, '${ownerId}'::uuid, '${ownerId}'::uuid, now(), now());
  `);
}

function insertPin(): void {
  runDatabaseScript(`
    INSERT INTO "item_source_revision_pins"
      ("item_source_reference_id","project_id","item_id","screenplay_id","screenplay_revision_id",
       "screenplay_version","source_start","source_end","source_text_hash",
       "created_by_id","updated_by_id","created_at","updated_at")
    VALUES ('${referenceIds[1]}'::uuid, '${projectId}'::uuid, '${firstItemId}'::uuid,
            '${screenplayId}'::uuid, '${revisionId}'::uuid, 7,
            ${pinnedRange.start}, ${pinnedRange.end}, '${pinnedHash}',
            '${ownerId}'::uuid, '${ownerId}'::uuid, now(), now());
  `);
}

/**
 * Advances the mutable screenplay the way both mutation paths do: a REST update writes
 * `source_text`/`source_byte_length` and increments `version`, and the collaboration projection
 * service does exactly the same thing after replaying its Yjs log. A later export checkpoint is
 * added too, so "another revision exists" is covered as well as "the text changed".
 */
function advanceMutableScreenplay(): void {
  runDatabaseScript(`
    UPDATE "screenplays"
      SET "source_text" = ${sqlLiteral(rewrittenSource)},
          "source_byte_length" = ${utf8Length(rewrittenSource)},
          "version" = "version" + 1,
          "updated_at" = now()
      WHERE "id" = '${screenplayId}'::uuid;
    INSERT INTO "screenplay_revisions"
      ("id","screenplay_id","owner_user_id","screenplay_version","filename","paper_size","source_text","source_byte_length","created_at")
      VALUES ('${laterRevisionId}'::uuid, '${screenplayId}'::uuid, '${ownerId}'::uuid, 8, 'pinned.fountain', 'letter',
              ${sqlLiteral(rewrittenSource)}, ${utf8Length(rewrittenSource)}, now());
  `);
}

describe.runIf(databaseReachable())('Item source revision pin equivalence', () => {
  it('leaves every legacy PDF reference resolving identically across replay, pin, and unpin', () => {
    cleanup();
    seed();

    try {
      const before = legacySnapshot();
      expect(before, 'The fixture must produce three resolved references').toHaveLength(3);

      // Replay the real migration twice. The first run is the ordinary upgrade; the second models an
      // N-1 restore that brought its own `_prisma_migrations` back, so the file runs again.
      runDatabaseScript(migrationSql());
      runDatabaseScript(migrationSql());
      expect(
        pinCount(),
        'The migration must infer no pin: no legacy row carries a screenplay identity or offsets',
      ).toBe('0');
      expect(
        legacySnapshot(),
        'Applying the expand migration changed how an existing source reference resolves',
      ).toEqual(before);

      checkpointAndLink();
      insertPin();
      expect(pinCount()).toBe('1');
      expect(
        legacySnapshot(),
        'Pinning one reference changed how the PDF source references resolve',
      ).toEqual(before);

      advanceMutableScreenplay();
      expect(
        legacySnapshot(),
        'Advancing the linked screenplay changed how a PDF source reference resolves',
      ).toEqual(before);

      runDatabaseScript(
        `DELETE FROM "item_source_revision_pins" WHERE "project_id" = '${projectId}'::uuid;`,
      );
      expect(
        legacySnapshot(),
        'Unpinning changed how an existing PDF source reference resolves',
      ).toEqual(before);
    } finally {
      cleanup();
    }
  }, 120_000);

  it('resolves a pinned reference to its revision text no matter how the screenplay advances', () => {
    cleanup();
    seed();
    runDatabaseScript(migrationSql());
    checkpointAndLink();
    insertPin();

    try {
      const pinnedBefore = pinnedSnapshot();
      expect(pinnedBefore).toEqual([
        {
          reference: referenceIds[1],
          revision: revisionId,
          pinnedVersion: 7,
          start: pinnedRange.start,
          end: pinnedRange.end,
          hash: pinnedHash,
          excerpt: pinnedExcerpt,
          sourceDocument: sourceDocumentId,
          startPage: 4,
          endPage: 9,
        },
      ]);
      expect(
        pinnedExcerpt,
        'The UTF-16 range must land on the sentence, not on a byte boundary',
      ).toBe('MAYA sets down the envelope.');

      // The screenplay moves on twice: an edit, then a second export checkpoint at the new version.
      advanceMutableScreenplay();
      expect(
        queryDatabase(`SELECT "version" FROM "screenplays" WHERE "id" = '${screenplayId}'::uuid`),
      ).toBe('8');
      expect(
        queryDatabase(
          `SELECT "source_text" = ${sqlLiteral(rewrittenSource)} FROM "screenplays" WHERE "id" = '${screenplayId}'::uuid`,
        ),
        'The fixture must actually have rewritten the mutable screenplay',
      ).toBe('t');

      expect(
        pinnedSnapshot(),
        'A REST or collaborative edit to Screenplay.sourceText changed a pinned resolution',
      ).toEqual(pinnedBefore);

      // Replay after an N-1 restore must not duplicate the pin or rewrite its range.
      runDatabaseScript(migrationSql());
      expect(pinCount(), 'Migration replay duplicated a pin row').toBe('1');
      expect(pinnedSnapshot(), 'Migration replay rewrote a pin').toEqual(pinnedBefore);
    } finally {
      cleanup();
    }
  }, 120_000);

  it('has no database-level protection against an orphaned pin, so purge order is load-bearing', () => {
    cleanup();
    seed();
    runDatabaseScript(migrationSql());
    checkpointAndLink();
    insertPin();

    try {
      expect(
        queryDatabase(`
          SELECT count(*) FROM "information_schema"."table_constraints"
          WHERE "table_name" = 'item_source_revision_pins' AND "constraint_type" = 'FOREIGN KEY'
        `),
        'A foreign key here would break pg_restore --clean of an N-1 backup',
      ).toBe('0');

      // Nothing stops the revision, the screenplay, or the reference from going away underneath the
      // pin, and nothing cascades. That is exactly why every purge path in apps/api/src/trash
      // deletes pin rows explicitly, and why every read re-validates the plain ids.
      runDatabaseScript(`
        DELETE FROM "screenplay_revisions" WHERE "id" = '${revisionId}'::uuid;
      `);
      expect(
        pinCount(),
        'Deleting the pinned revision must be able to strand a pin row; if it cannot, the table ' +
          'grew a foreign key and the N-1 restore convention is broken',
      ).toBe('1');
      expect(
        pinnedSnapshot(),
        'A stranded pin must resolve to nothing rather than to some other revision',
      ).toEqual([]);
      expect(
        legacySnapshot(),
        'A stranded pin must leave the PDF references it annotates completely untouched',
      ).toHaveLength(3);

      // The purge order the application actually uses: pin rows first, then the screenplay.
      runDatabaseScript(`
        DELETE FROM "item_source_revision_pins" WHERE "screenplay_id" = '${screenplayId}'::uuid;
        DELETE FROM "breakdown_screenplay_links" WHERE "screenplay_id" = '${screenplayId}'::uuid;
        DELETE FROM "screenplay_revisions" WHERE "screenplay_id" = '${screenplayId}'::uuid;
        DELETE FROM "screenplays" WHERE "id" = '${screenplayId}'::uuid;
      `);
      expect(pinCount(), 'Purging a screenplay must leave no orphaned pin row').toBe('0');
      expect(
        legacySnapshot(),
        'Purging a pinned screenplay must not disturb the breakdown PDF references',
      ).toHaveLength(3);
    } finally {
      cleanup();
    }
  }, 120_000);

  it('rejects a range or digest the contract forbids', () => {
    cleanup();
    seed();
    runDatabaseScript(migrationSql());
    checkpointAndLink();

    const attempt = (start: number, end: number, hash: string): void => {
      runDatabaseScript(`
        INSERT INTO "item_source_revision_pins"
          ("item_source_reference_id","project_id","item_id","screenplay_id","screenplay_revision_id",
           "screenplay_version","source_start","source_end","source_text_hash",
           "created_by_id","updated_by_id","created_at","updated_at")
        VALUES ('${referenceIds[0]}'::uuid, '${projectId}'::uuid, '${firstItemId}'::uuid,
                '${screenplayId}'::uuid, '${revisionId}'::uuid, 7, ${start}, ${end}, '${hash}',
                '${ownerId}'::uuid, '${ownerId}'::uuid, now(), now());
      `);
    };

    try {
      // Half-open and non-empty are enforced in the database, not only in Zod, so a future service
      // or a direct fix-up script cannot store a degenerate range.
      expect(() => attempt(10, 10, pinnedHash), 'an empty range').toThrow();
      expect(() => attempt(20, 10, pinnedHash), 'an inverted range').toThrow();
      expect(() => attempt(-1, 10, pinnedHash), 'a negative start').toThrow();
      expect(() => attempt(10, 20, 'NOTAHASH'), 'a non-sha256 digest').toThrow();
      expect(() => attempt(10, 20, pinnedHash.toUpperCase()), 'an uppercase digest').toThrow();
      expect(pinCount(), 'No rejected pin may have been stored').toBe('0');

      attempt(0, 17, createHash('sha256').update(pinnedSource.slice(0, 17), 'utf8').digest('hex'));
      expect(pinCount()).toBe('1');
    } finally {
      cleanup();
    }
  }, 120_000);
});
