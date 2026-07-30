-- Durable screenplay conversion artifacts (issue #244).
--
-- This is an additive, replay-safe table. screenplay_id and created_by_user_id are plain UUIDs
-- with NO foreign keys onto the core screenplays/users tables, and lifecycle status is VARCHAR
-- rather than a shared enum. That independence lets pg_restore --clean restore an N-1 dump before
-- Prisma safely replays this migration. No existing table or type is altered.
CREATE TABLE IF NOT EXISTS "screenplay_import_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "screenplay_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "object_key" TEXT NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(255) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "source_format" VARCHAR(64) NOT NULL,
  "converted_fountain" TEXT,
  "report_schema_version" INTEGER,
  "conversion_report" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  CONSTRAINT "screenplay_import_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "screenplay_import_artifacts_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "screenplay_import_artifacts_version_check" CHECK ("version" > 0),
  CONSTRAINT "screenplay_import_artifacts_status_check"
    CHECK ("status" IN ('PENDING', 'READY', 'FAILED')),
  CONSTRAINT "screenplay_import_artifacts_lifecycle_check" CHECK (
    (
      "status" = 'PENDING'
      AND "converted_fountain" IS NULL
      AND "report_schema_version" IS NULL
      AND "conversion_report" IS NULL
      AND "completed_at" IS NULL
      AND "failed_at" IS NULL
    ) OR (
      "status" = 'READY'
      AND "converted_fountain" IS NOT NULL
      AND "report_schema_version" IS NOT NULL
      AND "conversion_report" IS NOT NULL
      AND "completed_at" IS NOT NULL
      AND "failed_at" IS NULL
      AND ("conversion_report"->>'schemaVersion')::INTEGER = "report_schema_version"
    ) OR (
      "status" = 'FAILED'
      AND "converted_fountain" IS NULL
      AND "report_schema_version" IS NULL
      AND "conversion_report" IS NULL
      AND "completed_at" IS NULL
      AND "failed_at" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "screenplay_import_artifacts_object_key_key"
  ON "screenplay_import_artifacts"("object_key");
CREATE INDEX IF NOT EXISTS "screenplay_import_artifacts_screenplay_id_created_at_idx"
  ON "screenplay_import_artifacts"("screenplay_id", "created_at");
CREATE INDEX IF NOT EXISTS "screenplay_import_artifacts_status_created_at_idx"
  ON "screenplay_import_artifacts"("status", "created_at");
