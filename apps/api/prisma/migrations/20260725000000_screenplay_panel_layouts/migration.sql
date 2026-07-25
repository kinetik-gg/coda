-- Self-contained per-user screenplay panel layout. Like the other appended operational tables
-- (user_two_factor, scheduled_job_status, ...) it carries no foreign key back onto a core table:
-- an old backup dump has no knowledge of this table, so a `pg_restore --clean` of that dump onto a
-- migrated database would fail to drop core constraints (e.g. screenplays_pkey) if a dependent FK
-- existed here. Plain `screenplay_id`/`user_id` columns keep the restore path clean; rows are
-- purged explicitly by whichever future path deletes a screenplay (none exists today).
CREATE TABLE "screenplay_panel_layouts" (
  "screenplay_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "layout" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screenplay_panel_layouts_pkey" PRIMARY KEY ("screenplay_id", "user_id"),
  CONSTRAINT "screenplay_panel_layouts_schema_version_check"
    CHECK ("schema_version" > 0 AND "layout" ? 'schemaVersion' AND ("layout"->>'schemaVersion')::INTEGER = "schema_version"),
  CONSTRAINT "screenplay_panel_layouts_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "screenplay_panel_layouts_layout_size_check" CHECK (octet_length("layout"::TEXT) <= 65536)
);

CREATE INDEX "screenplay_panel_layouts_user_id_idx" ON "screenplay_panel_layouts"("user_id");
