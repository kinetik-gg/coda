-- Storage objects gain a tracker owner (epic #386). A storage object has so far always belonged
-- to a breakdown project; tracker field values of kind file/image/video need the same anchor.
--
-- `project_id`/`tracker_id` are a discriminated pair: exactly one is ever set, enforced by the
-- `storage_objects_owner_check` CHECK constraint added here. `project_id` becomes nullable in the
-- same expand-only step; every existing row keeps its real `project_id` and no `tracker_id`, so
-- it already satisfies the new constraint and no backfill is needed. The project FK predates the
-- appended-table convention and stays allowlisted; the tracker side is deliberately plain (no FK).
--
-- Idempotent for replay after an N-1 `pg_restore --clean`: `ADD COLUMN IF NOT EXISTS`,
-- `DROP NOT NULL` is a no-op the second time, and both constraints are existence-guarded.
ALTER TABLE "storage_objects" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "storage_objects" ADD COLUMN IF NOT EXISTS "tracker_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storage_objects_owner_check'
  ) THEN
    ALTER TABLE "storage_objects"
      ADD CONSTRAINT "storage_objects_owner_check"
      CHECK (num_nonnulls("project_id", "tracker_id") = 1);
  END IF;
END $$;
