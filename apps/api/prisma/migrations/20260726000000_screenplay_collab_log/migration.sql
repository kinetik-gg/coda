-- Live collaboration durable update log (ADR: docs/adr-collaboration-engine-and-transport.md).
-- Two appended tables: an append-only per-screenplay Yjs update log, authoritative for
-- convergence, and a single compacted checkpoint per screenplay written by the compaction job.
-- `Screenplay.sourceText` remains the canonical Fountain projection; these tables never replace it.
--
-- Backup/restore convention (matches user_two_factor, scheduled_job_status,
-- screenplay_panel_layouts, the screenplay access-control tables, ...): plain `screenplay_id` /
-- `author_user_id` columns with NO foreign key onto the core `screenplays`/`users` tables, no
-- shared enum type (status-like fields, if any, are plain VARCHAR) and no citext. The in-app
-- restore runs `pg_restore --clean --if-exists`, whose DROP statements are scoped to objects
-- present in the dump; an N-1 backup predates these tables, so a foreign key from them onto a core
-- table would block dropping a core constraint (e.g. screenplays_pkey) during the round-trip.
--
-- `_prisma_migrations` travels inside that dump as well, so this file runs again after a restore
-- (issue #324). CREATE ... IF NOT EXISTS makes the replay a no-op, including for the inline
-- PRIMARY KEY and UNIQUE constraints, which a skipped CREATE TABLE never reaches. There is no
-- data backfill here, so nothing else needs a guard.

CREATE TABLE IF NOT EXISTS "screenplay_collab_updates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "screenplay_id" UUID NOT NULL,
  "seq" INTEGER NOT NULL,
  "author_user_id" UUID NOT NULL,
  "actor_client_id" VARCHAR(32) NOT NULL,
  "payload" BYTEA NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("screenplay_id", "seq")
);
CREATE INDEX IF NOT EXISTS "screenplay_collab_updates_screenplay_id_created_at_idx" ON "screenplay_collab_updates"("screenplay_id", "created_at");

-- One row per screenplay: the compacted Yjs state as of `through_seq`, replacing the folded log
-- rows. `document_digest` is a sha256 of the materialised Fountain text at fold time, so a future
-- fold can assert byte-identity against the canonical `sourceText` before it deletes anything.
CREATE TABLE IF NOT EXISTS "screenplay_collab_checkpoints" (
  "screenplay_id" UUID PRIMARY KEY,
  "through_seq" INTEGER NOT NULL,
  "payload" BYTEA NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "document_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
