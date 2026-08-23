-- Activity events gain a tracker container (epic #386). Plain, indexed, NO foreign key onto the
-- core tables (appended-table convention): the column names the tracker an event belongs to and
-- is written only by application code that has already resolved it.
--
-- Expand-only and replay-safe: `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "tracker_id" UUID;

CREATE INDEX IF NOT EXISTS "activity_events_tracker_id_idx" ON "activity_events"("tracker_id");
