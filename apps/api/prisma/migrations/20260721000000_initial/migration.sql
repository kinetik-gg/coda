CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'ENUM', 'MULTI_ENUM', 'INTEGER', 'FLOAT', 'BOOLEAN', 'DATE', 'FILE', 'IMAGE', 'VIDEO');
CREATE TYPE "StorageKind" AS ENUM ('SOURCE_DOCUMENT', 'FILE', 'IMAGE', 'VIDEO');
CREATE TYPE "StorageStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
CREATE TYPE "ActivityAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'RESTORED', 'PURGED', 'INVITED', 'ACCEPTED', 'TRANSFERRED', 'COMMENTED');

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY,
  "email" CITEXT NOT NULL UNIQUE,
  "display_name" VARCHAR(120) NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "instance_settings" (
  "id" UUID PRIMARY KEY,
  "owner_user_id" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "initialized_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

CREATE TABLE "password_reset_tokens" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "projects" (
  "id" UUID PRIMARY KEY,
  "owner_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID
);
CREATE INDEX "projects_owner_user_id_idx" ON "projects"("owner_user_id");
CREATE INDEX "projects_deleted_at_idx" ON "projects"("deleted_at");

CREATE TABLE "project_roles" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "is_owner" BOOLEAN NOT NULL DEFAULT false,
  "position" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  UNIQUE ("project_id", "name")
);
CREATE UNIQUE INDEX "project_roles_one_owner_idx" ON "project_roles"("project_id") WHERE "is_owner";
CREATE INDEX "project_roles_project_id_position_idx" ON "project_roles"("project_id", "position");

CREATE TABLE "project_role_permissions" (
  "id" UUID PRIMARY KEY,
  "role_id" UUID NOT NULL REFERENCES "project_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "permission" VARCHAR(64) NOT NULL,
  UNIQUE ("role_id", "permission")
);

CREATE TABLE "project_memberships" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role_id" UUID NOT NULL REFERENCES "project_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("project_id", "user_id")
);
CREATE INDEX "project_memberships_user_id_idx" ON "project_memberships"("user_id");

CREATE TABLE "project_invitations" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role_id" UUID NOT NULL REFERENCES "project_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "email" CITEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "inviter_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "accepted_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "project_invitations_project_id_status_idx" ON "project_invitations"("project_id", "status");

CREATE TABLE "entity_types" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "parent_type_id" UUID REFERENCES "entity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "singular_name" VARCHAR(80) NOT NULL,
  "plural_name" VARCHAR(80) NOT NULL,
  "display_prefix" VARCHAR(20),
  "level" INTEGER NOT NULL CHECK ("level" BETWEEN 1 AND 3),
  "position" VARCHAR(64) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  UNIQUE ("project_id", "level")
);
CREATE INDEX "entity_types_project_id_position_idx" ON "entity_types"("project_id", "position");

CREATE TABLE "breakdown_items" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "entity_type_id" UUID NOT NULL REFERENCES "entity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "parent_id" UUID REFERENCES "breakdown_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" VARCHAR(300) NOT NULL,
  "display_code" VARCHAR(80),
  "description" TEXT,
  "position" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID
);
CREATE INDEX "breakdown_items_project_id_entity_type_id_parent_id_deleted_idx" ON "breakdown_items"("project_id", "entity_type_id", "parent_id", "deleted_at", "position");
CREATE INDEX "breakdown_items_project_id_updated_at_idx" ON "breakdown_items"("project_id", "updated_at");

CREATE TABLE "field_definitions" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "entity_type_id" UUID NOT NULL REFERENCES "entity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(120) NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "type" "FieldType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "position" VARCHAR(64) NOT NULL,
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID,
  UNIQUE ("entity_type_id", "key")
);
CREATE INDEX "field_definitions_entity_type_id_deleted_at_position_idx" ON "field_definitions"("entity_type_id", "deleted_at", "position");

CREATE TABLE "field_options" (
  "id" UUID PRIMARY KEY,
  "field_id" UUID NOT NULL REFERENCES "field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "label" VARCHAR(120) NOT NULL,
  "color" VARCHAR(32),
  "position" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(3)
);
CREATE INDEX "field_options_field_id_position_idx" ON "field_options"("field_id", "position");

CREATE TABLE "storage_objects" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "StorageKind" NOT NULL,
  "status" "StorageStatus" NOT NULL DEFAULT 'PENDING',
  "object_key" TEXT NOT NULL UNIQUE,
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(255) NOT NULL,
  "size_bytes" BIGINT NOT NULL CHECK ("size_bytes" > 0),
  "width" INTEGER,
  "height" INTEGER,
  "duration_ms" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID
);
CREATE INDEX "storage_objects_project_id_deleted_at_created_at_idx" ON "storage_objects"("project_id", "deleted_at", "created_at");

CREATE TABLE "field_values" (
  "id" UUID PRIMARY KEY,
  "item_id" UUID NOT NULL REFERENCES "breakdown_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "field_id" UUID NOT NULL REFERENCES "field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "text_value" TEXT,
  "integer_value" INTEGER,
  "float_value" DOUBLE PRECISION,
  "boolean_value" BOOLEAN,
  "date_value" DATE,
  "option_id" UUID REFERENCES "field_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "storage_object_id" UUID REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("item_id", "field_id"),
  CHECK (num_nonnulls("text_value", "integer_value", "float_value", "boolean_value", "date_value", "option_id", "storage_object_id") <= 1)
);
CREATE INDEX "field_values_field_id_text_value_idx" ON "field_values"("field_id", "text_value");
CREATE INDEX "field_values_field_id_integer_value_idx" ON "field_values"("field_id", "integer_value");
CREATE INDEX "field_values_field_id_float_value_idx" ON "field_values"("field_id", "float_value");
CREATE INDEX "field_values_field_id_boolean_value_idx" ON "field_values"("field_id", "boolean_value");
CREATE INDEX "field_values_field_id_date_value_idx" ON "field_values"("field_id", "date_value");

CREATE TABLE "field_value_options" (
  "field_value_id" UUID NOT NULL REFERENCES "field_values"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "option_id" UUID NOT NULL REFERENCES "field_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("field_value_id", "option_id")
);

CREATE TABLE "source_documents" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "storage_object_id" UUID NOT NULL UNIQUE REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" VARCHAR(255) NOT NULL,
  "page_count" INTEGER CHECK ("page_count" IS NULL OR "page_count" > 0),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  "deletion_batch_id" UUID
);
CREATE INDEX "source_documents_project_id_deleted_at_idx" ON "source_documents"("project_id", "deleted_at");

CREATE TABLE "item_source_references" (
  "id" UUID PRIMARY KEY,
  "item_id" UUID NOT NULL REFERENCES "breakdown_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "source_document_id" UUID NOT NULL REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "start_page" INTEGER NOT NULL CHECK ("start_page" > 0),
  "end_page" INTEGER NOT NULL CHECK ("end_page" >= "start_page"),
  "position" VARCHAR(64) NOT NULL
);
CREATE INDEX "item_source_references_item_id_position_idx" ON "item_source_references"("item_id", "position");

CREATE TABLE "comments" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "item_id" UUID NOT NULL REFERENCES "breakdown_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "author_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "comments_item_id_deleted_at_created_at_idx" ON "comments"("item_id", "deleted_at", "created_at");

CREATE TABLE "activity_events" (
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actor_id" UUID REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "action" "ActivityAction" NOT NULL,
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "activity_events_project_id_created_at_idx" ON "activity_events"("project_id", "created_at");
