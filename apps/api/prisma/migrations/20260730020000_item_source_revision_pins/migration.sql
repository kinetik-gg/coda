-- Pin a breakdown source reference to an immutable screenplay revision (issue #239).
--
-- Expand step only, per docs/data-compatibility.md. `item_source_references` keeps every column it
-- has: `source_document_id`, `start_page`, and `end_page` still describe the PDF, and a reference
-- without a row here resolves exactly as it did before this migration existed. No pin is inferred
-- for a legacy row, because nothing in the database knows which screenplay a PDF came from.
--
-- Plain UUID identifiers deliberately carry NO foreign key -- not onto `item_source_references`,
-- `breakdown_items`, `projects`, `screenplays`, `screenplay_revisions`, or `users`. An N-1 dump does
-- not know this table exists, so `pg_restore --clean` must stay free to drop and recreate every one
-- of those tables while these rows sit beside them. There is deliberately no foreign key onto
-- `breakdown_screenplay_links` either: CASCADE would silently destroy a user's pins when the
-- breakdown is pointed at a different screenplay, and RESTRICT would make unlinking impossible.
-- Cleanup is therefore explicit in `apps/api/src/trash/*` and every read re-validates the ids.
--
-- Because `_prisma_migrations` travels inside the dump, this file runs again after a restore.
-- CREATE ... IF NOT EXISTS makes that replay a no-op, including for the inline CHECK constraints.
CREATE TABLE IF NOT EXISTS "item_source_revision_pins" (
  "item_source_reference_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "screenplay_id" UUID NOT NULL,
  "screenplay_revision_id" UUID NOT NULL,
  -- The pinned revision's `screenplay_version`, denormalised so "the screenplay has moved on" is a
  -- comparison against `screenplays"."version` and never a join through `screenplay_revisions`.
  "screenplay_version" INTEGER NOT NULL,
  -- Half-open [source_start, source_end) in UTF-16 code units of the revision's `source_text`.
  -- Not bytes: `screenplay_revisions"."source_byte_length` is UTF-8 and is not interchangeable.
  "source_start" INTEGER NOT NULL,
  "source_end" INTEGER NOT NULL,
  -- Lowercase hex SHA-256 of the UTF-8 encoding of the pinned excerpt. Evidence, not storage: the
  -- revision holds the text, this detects a range that no longer quotes what it claims to.
  "source_text_hash" TEXT NOT NULL,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "item_source_revision_pins_pkey" PRIMARY KEY ("item_source_reference_id"),
  CONSTRAINT "item_source_revision_pins_version_check" CHECK ("screenplay_version" >= 1),
  CONSTRAINT "item_source_revision_pins_range_check"
    CHECK ("source_start" >= 0 AND "source_end" > "source_start"),
  CONSTRAINT "item_source_revision_pins_hash_check"
    CHECK ("source_text_hash" ~ '^[0-9a-f]{64}$')
);

-- Purge paths delete by project, by item, and by screenplay; the rebase flow reads by revision.
CREATE INDEX IF NOT EXISTS "item_source_revision_pins_project_id_idx"
  ON "item_source_revision_pins"("project_id");
CREATE INDEX IF NOT EXISTS "item_source_revision_pins_item_id_idx"
  ON "item_source_revision_pins"("item_id");
CREATE INDEX IF NOT EXISTS "item_source_revision_pins_screenplay_id_idx"
  ON "item_source_revision_pins"("screenplay_id");
CREATE INDEX IF NOT EXISTS "item_source_revision_pins_screenplay_revision_id_idx"
  ON "item_source_revision_pins"("screenplay_revision_id");
