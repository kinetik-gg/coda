-- Tracker trigram search indexes, mirroring 20260723020000_search_trigram_indexes: Prisma's
-- case-insensitive `contains` filter emits substring predicates that B-tree indexes cannot
-- accelerate. Partial GIN indexes keep deleted rows out of the two high-traffic tracker searches.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "trackers_name_trgm_idx"
  ON "trackers" USING GIN ("name" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "tracker_records_title_trgm_idx"
  ON "tracker_records" USING GIN ("title" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;
