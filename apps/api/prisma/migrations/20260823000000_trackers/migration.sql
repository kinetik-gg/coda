-- Trackers (epic #386): Space-held flat record grids with user-defined fields.
-- Expand-only migration: creates the whole tracker family in one release. No core table is
-- touched and no existing row changes, so this applies online.
--
-- Backup/restore convention (matches screenplay_access_control, spaces, project_user_workspace_
-- layouts): every new table carries plain `tracker_id`/`user_id`/`owner_user_id`/... columns with
-- NO foreign keys onto the core `trackers`(itself new)/`users`/`projects`/`screenplays` tables,
-- no `citext`, and no shared enum type (`tracker_fields.type` is a plain VARCHAR holding the
-- contracts FieldType member names). An N-1 dump predates every one of these tables, so any FK
-- from them onto a core table or type would block dropping that constraint/type during the
-- round-trip. Foreign keys strictly WITHIN this family (the role graph via `role_id`, the
-- field/value chain, comments via `record_id`) are safe — an old dump lacks all of them together,
-- so their constraints are never dropped — and are kept for referential integrity + cascades.
--
-- `_prisma_migrations` travels inside that same dump, so this file runs again after a restore:
-- every CREATE is IF NOT EXISTS (which also covers inline PRIMARY KEY/UNIQUE constraints), so the
-- replay is a no-op instead of a duplicate-object crash on boot.

CREATE TABLE IF NOT EXISTS "trackers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" VARCHAR(1000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID
);
CREATE INDEX IF NOT EXISTS "trackers_owner_user_id_updated_at_idx" ON "trackers"("owner_user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "trackers_deleted_at_idx" ON "trackers"("deleted_at");

CREATE TABLE IF NOT EXISTS "tracker_roles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tracker_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "is_owner" BOOLEAN NOT NULL DEFAULT false,
  "position" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  UNIQUE ("tracker_id", "name")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_roles_one_owner_idx" ON "tracker_roles"("tracker_id") WHERE "is_owner";
CREATE INDEX IF NOT EXISTS "tracker_roles_tracker_id_position_idx" ON "tracker_roles"("tracker_id", "position");

CREATE TABLE IF NOT EXISTS "tracker_role_permissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "role_id" UUID NOT NULL REFERENCES "tracker_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "permission" VARCHAR(64) NOT NULL,
  UNIQUE ("role_id", "permission")
);

CREATE TABLE IF NOT EXISTS "tracker_memberships" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tracker_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL REFERENCES "tracker_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tracker_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "tracker_memberships_user_id_idx" ON "tracker_memberships"("user_id");

CREATE TABLE IF NOT EXISTS "tracker_invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tracker_id" UUID NOT NULL,
  "role_id" UUID NOT NULL REFERENCES "tracker_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Base types only (TEXT / VARCHAR), not citext or the InvitationStatus enum: those shared types
  -- live in an N-1 dump, and a dependent column would block pg_restore --clean from dropping them.
  -- Email is already normalised to lowercase by the request schema.
  "email" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "inviter_id" UUID NOT NULL,
  "accepted_by_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "tracker_invitations_tracker_id_status_idx" ON "tracker_invitations"("tracker_id", "status");

-- `type` holds the contracts FieldType member names ('TEXT', 'LONG_TEXT', ...) as a base VARCHAR:
-- a new column may not depend on the shared enum (see header).
CREATE TABLE IF NOT EXISTS "tracker_fields" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tracker_id" UUID NOT NULL REFERENCES "trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" VARCHAR(120) NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "position" VARCHAR(64) NOT NULL,
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID,
  UNIQUE ("tracker_id", "key")
);
CREATE INDEX IF NOT EXISTS "tracker_fields_tracker_id_deleted_at_position_idx"
  ON "tracker_fields"("tracker_id", "deleted_at", "position");

CREATE TABLE IF NOT EXISTS "tracker_field_options" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "field_id" UUID NOT NULL REFERENCES "tracker_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "label" VARCHAR(120) NOT NULL,
  "color" VARCHAR(32),
  "position" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(3)
);
CREATE INDEX IF NOT EXISTS "tracker_field_options_field_id_position_idx"
  ON "tracker_field_options"("field_id", "position");

CREATE TABLE IF NOT EXISTS "tracker_records" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tracker_id" UUID NOT NULL REFERENCES "trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" VARCHAR(300) NOT NULL,
  "position" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID
);
CREATE INDEX IF NOT EXISTS "tracker_records_tracker_id_deleted_at_position_idx"
  ON "tracker_records"("tracker_id", "deleted_at", "position");
CREATE INDEX IF NOT EXISTS "tracker_records_tracker_id_updated_at_idx"
  ON "tracker_records"("tracker_id", "updated_at");

CREATE TABLE IF NOT EXISTS "tracker_field_values" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "record_id" UUID NOT NULL REFERENCES "tracker_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "field_id" UUID NOT NULL REFERENCES "tracker_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "text_value" TEXT,
  "integer_value" INTEGER,
  "float_value" DOUBLE PRECISION,
  "boolean_value" BOOLEAN,
  "date_value" DATE,
  "option_id" UUID,
  "storage_object_id" UUID,
  UNIQUE ("record_id", "field_id")
);
CREATE INDEX IF NOT EXISTS "tracker_field_values_field_id_idx" ON "tracker_field_values"("field_id");

-- Per-type partial indexes (mirrors field_values' typed indexes; the partial predicate keeps each
-- index to exactly the rows of its value type). These are query-path indexes outside the Prisma
-- schema, same as the trigram set below.
CREATE INDEX IF NOT EXISTS "tracker_field_values_field_integer_pidx"
  ON "tracker_field_values"("field_id", "integer_value") WHERE "integer_value" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tracker_field_values_field_float_pidx"
  ON "tracker_field_values"("field_id", "float_value") WHERE "float_value" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tracker_field_values_field_boolean_pidx"
  ON "tracker_field_values"("field_id", "boolean_value") WHERE "boolean_value" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tracker_field_values_field_date_pidx"
  ON "tracker_field_values"("field_id", "date_value") WHERE "date_value" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "tracker_field_value_options" (
  "field_value_id" UUID NOT NULL REFERENCES "tracker_field_values"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "option_id" UUID NOT NULL REFERENCES "tracker_field_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tracker_field_value_options_pkey" PRIMARY KEY ("field_value_id", "option_id")
);

CREATE TABLE IF NOT EXISTS "tracker_comments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "record_id" UUID NOT NULL REFERENCES "tracker_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Plain column, no FK onto users (appended-table convention; author identity is app-enforced).
  "author_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "edited_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX IF NOT EXISTS "tracker_comments_record_id_deleted_at_created_at_idx"
  ON "tracker_comments"("record_id", "deleted_at", "created_at");

-- Tracker workspace layouts mirror the breakdown pair (project_workspace_defaults /
-- project_user_workspace_layouts). Both stay FK-free: an N-1 dump does not know these tables
-- exist, so pg_restore --clean must remain free to replace the core tables before replay.
CREATE TABLE IF NOT EXISTS "tracker_workspace_defaults" (
  "tracker_id" UUID NOT NULL,
  "layout" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "published_by_id" UUID,
  "published_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracker_workspace_defaults_pkey" PRIMARY KEY ("tracker_id")
);

CREATE TABLE IF NOT EXISTS "tracker_user_workspace_layouts" (
  "tracker_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "layout" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracker_user_workspace_layouts_pkey" PRIMARY KEY ("tracker_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "tracker_user_workspace_layouts_user_id_idx"
  ON "tracker_user_workspace_layouts"("user_id");
