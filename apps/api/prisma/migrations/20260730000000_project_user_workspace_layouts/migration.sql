-- Additive per-user/per-project breakdown layout identity (issue #217).
--
-- The legacy project_membership_workspace_layouts table remains intact for the expand phase.
-- Its direct-membership rows seed the new canonical table, while Space-only users can now own a
-- layout without a synthetic project_memberships row.
--
-- This table carries plain project_id/user_id columns with NO foreign keys onto the core projects
-- or users tables. An N-1 dump does not know this table exists, so pg_restore --clean must remain
-- free to replace core constraints before this migration is replayed. CREATE/INDEX/backfill are
-- conflict-safe because _prisma_migrations is restored from the N-1 dump while this table survives.
CREATE TABLE IF NOT EXISTS "project_user_workspace_layouts" (
  "project_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "layout" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "based_on_default_revision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_user_workspace_layouts_pkey" PRIMARY KEY ("project_id", "user_id"),
  CONSTRAINT "project_user_workspace_layouts_schema_version_check"
    CHECK ("schema_version" > 0 AND "layout" ? 'schemaVersion' AND ("layout"->>'schemaVersion')::INTEGER = "schema_version"),
  CONSTRAINT "project_user_workspace_layouts_revision_check"
    CHECK ("revision" >= 0 AND "based_on_default_revision" >= 0),
  CONSTRAINT "project_user_workspace_layouts_layout_size_check"
    CHECK (octet_length("layout"::TEXT) <= 65536)
);

CREATE INDEX IF NOT EXISTS "project_user_workspace_layouts_user_id_idx"
  ON "project_user_workspace_layouts"("user_id");

-- Replaying after an N-1 restore intentionally refreshes direct-member rows from the restored
-- legacy table. Rows belonging only to Space reach remain harmless personal state: every request
-- still re-authorises current reach before reading or mutating them.
INSERT INTO "project_user_workspace_layouts" (
  "project_id",
  "user_id",
  "layout",
  "schema_version",
  "based_on_default_revision",
  "revision",
  "created_at",
  "updated_at"
)
SELECT
  membership."project_id",
  membership."user_id",
  personal."layout",
  personal."schema_version",
  personal."based_on_default_revision",
  personal."revision",
  personal."created_at",
  personal."updated_at"
FROM "project_membership_workspace_layouts" personal
JOIN "project_memberships" membership ON membership."id" = personal."membership_id"
ON CONFLICT ("project_id", "user_id") DO UPDATE SET
  "layout" = EXCLUDED."layout",
  "schema_version" = EXCLUDED."schema_version",
  "based_on_default_revision" = EXCLUDED."based_on_default_revision",
  "revision" = EXCLUDED."revision",
  "created_at" = EXCLUDED."created_at",
  "updated_at" = EXCLUDED."updated_at";
