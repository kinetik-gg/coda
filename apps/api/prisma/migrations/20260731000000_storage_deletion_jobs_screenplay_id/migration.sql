-- A screenplay purge was writing the screenplay id into `storage_deletion_jobs.project_id`
-- (issue #283): nothing enforced the column's meaning, so it silently held two different kinds of
-- id. This adds a nullable `screenplay_id` sibling and a CHECK constraint making the pair a proper
-- discriminated union -- exactly one of `project_id`/`screenplay_id` is ever set. Both columns stay
-- foreign-key-free (the appended-table convention: this table has never had one), so this is a
-- discriminator, not a relation, and needs no FK onto `projects` or `screenplays`.
--
-- Expand step only, per docs/data-compatibility.md: every existing row already has a real
-- `project_id` and no `screenplay_id`, which already satisfies the new CHECK constraint, so no
-- backfill is needed.
--
-- Idempotent for replay after an N-1 `pg_restore --clean` (`_prisma_migrations` travels inside the
-- dump): `ADD COLUMN IF NOT EXISTS`, `DROP NOT NULL` is a no-op the second time, and the
-- constraint is guarded by a existence check before being added.
ALTER TABLE "storage_deletion_jobs" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "storage_deletion_jobs" ADD COLUMN IF NOT EXISTS "screenplay_id" UUID;

CREATE INDEX IF NOT EXISTS "storage_deletion_jobs_screenplay_id_idx"
  ON "storage_deletion_jobs"("screenplay_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storage_deletion_jobs_owner_check'
  ) THEN
    ALTER TABLE "storage_deletion_jobs"
      ADD CONSTRAINT "storage_deletion_jobs_owner_check"
      CHECK (num_nonnulls("project_id", "screenplay_id") = 1);
  END IF;
END $$;
