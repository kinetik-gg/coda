-- Additive one-screenplay-per-breakdown foundation (issue #238).
--
-- Plain UUID identifiers deliberately have no foreign keys onto projects, screenplays, or users.
-- An N-1 dump does not know this table exists, so pg_restore --clean must remain free to replace
-- core constraints when this migration is replayed. CREATE/INDEX are therefore conflict-safe.
CREATE TABLE IF NOT EXISTS "breakdown_screenplay_links" (
  "project_id" UUID NOT NULL,
  "screenplay_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "breakdown_screenplay_links_pkey" PRIMARY KEY ("project_id")
);

CREATE INDEX IF NOT EXISTS "breakdown_screenplay_links_screenplay_id_idx"
  ON "breakdown_screenplay_links"("screenplay_id");
