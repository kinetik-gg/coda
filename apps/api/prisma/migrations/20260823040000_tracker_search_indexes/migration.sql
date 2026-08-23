-- Tracker search indexes. Deliberately free of pg_trgm: an N-1 backup dump
-- predating this migration contains a `DROP EXTENSION pg_trgm` in its restore
-- TOC, and any object created here that depends on the extension would block
-- that drop during `pg_restore --clean` (the same reason appended tables avoid
-- citext). Plain partial B-tree indexes accelerate case-insensitive equality,
-- prefix matching, and ordering without touching any extension; substring
-- `contains` remains a sequential scan, which is acceptable at tracker scale.
CREATE INDEX IF NOT EXISTS "trackers_name_lower_idx"
  ON "trackers" (lower("name"::text))
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "tracker_records_title_lower_idx"
  ON "tracker_records" (lower("title"::text))
  WHERE "deleted_at" IS NULL;
