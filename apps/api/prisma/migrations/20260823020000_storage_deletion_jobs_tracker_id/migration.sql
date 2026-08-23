-- Storage deletion jobs gain a tracker target (epic #386), extending the #283 discriminator.
-- The `project_id`/`screenplay_id` pair becomes a `project_id`/`screenplay_id`/`tracker_id`
-- triple: exactly one is ever set. Every existing row has exactly one of the first two set and
-- no `tracker_id`, so it already satisfies the widened CHECK and no backfill is needed. All three
-- columns stay foreign-key-free (this table has never had one) — a discriminator, not a relation.
--
-- The two-way constraint shipped by 20260731000000 is replaced here: if it exists without
-- mentioning `tracker_id` it is dropped, and the three-way form is then added whenever absent.
-- Both guards together make an interrupted apply or a replay after an N-1 restore converge on
-- exactly the new constraint instead of leaving the old one in place forever.
--
-- The constraint swap is additionally guarded on `screenplay_id` existing: the migration-replay
-- gate re-applies every rewound migration in isolation against the N-1-restored schema, where
-- that column (added by 20260731000000) is not yet present. In that state this migration must
-- succeed as the no-op it can safely be — the sequential deploy that operators actually run
-- applies 20260731000000 first, so the three-way form below is always reached for real.
ALTER TABLE "storage_deletion_jobs" ADD COLUMN IF NOT EXISTS "tracker_id" UUID;

CREATE INDEX IF NOT EXISTS "storage_deletion_jobs_tracker_id_idx"
  ON "storage_deletion_jobs"("tracker_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'storage_deletion_jobs' AND column_name = 'screenplay_id'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_deletion_jobs_owner_check'
      AND conrelid = '"storage_deletion_jobs"'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%tracker_id%'
  ) THEN
    ALTER TABLE "storage_deletion_jobs" DROP CONSTRAINT "storage_deletion_jobs_owner_check";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storage_deletion_jobs_owner_check'
      AND conrelid = '"storage_deletion_jobs"'::regclass
  ) THEN
    ALTER TABLE "storage_deletion_jobs"
      ADD CONSTRAINT "storage_deletion_jobs_owner_check"
      CHECK (num_nonnulls("project_id", "screenplay_id", "tracker_id") = 1);
  END IF;
END $$;
