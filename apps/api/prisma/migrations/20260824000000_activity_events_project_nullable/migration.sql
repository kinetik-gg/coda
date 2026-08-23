-- Tracker-scoped activity events (epic #386, S10) carry no project: a tracker is not
-- project-bound, so rows written by the tracker surfaces name only `tracker_id` (added in
-- 20260823030000) and leave the core-era `project_id` unset. The column relaxes from NOT NULL
-- to nullable; the foreign key itself stays, so no dump/restore compatibility changes.
--
-- Expand-only and replay-safe: `DROP NOT NULL` on an already-nullable column is a no-op,
-- mirroring the `IF NOT EXISTS` guards of the tracker_id migration.
ALTER TABLE "activity_events" ALTER COLUMN "project_id" DROP NOT NULL;
