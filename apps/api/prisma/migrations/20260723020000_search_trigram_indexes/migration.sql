CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Prisma's case-insensitive `contains` filter emits substring predicates that
-- B-tree indexes cannot accelerate. Partial trigram indexes keep deleted rows
-- out of the two high-traffic breakdown search indexes.
CREATE INDEX IF NOT EXISTS "breakdown_items_title_trgm_idx"
  ON "breakdown_items" USING GIN ("title" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "breakdown_items_display_code_trgm_idx"
  ON "breakdown_items" USING GIN ("display_code" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

-- Instance-management search spans these user profile columns.
CREATE INDEX IF NOT EXISTS "users_display_name_trgm_idx"
  ON "users" USING GIN ("display_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_email_trgm_idx"
  ON "users" USING GIN (("email"::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "instance_invitations_email_trgm_idx"
  ON "instance_invitations" USING GIN (("email"::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_company_trgm_idx"
  ON "users" USING GIN ("company" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_department_trgm_idx"
  ON "users" USING GIN ("department" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "projects_name_trgm_idx"
  ON "projects" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "storage_objects_original_filename_trgm_idx"
  ON "storage_objects" USING GIN ("original_filename" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "storage_objects_mime_type_trgm_idx"
  ON "storage_objects" USING GIN ("mime_type" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "activity_events_resource_type_trgm_idx"
  ON "activity_events" USING GIN ("resource_type" gin_trgm_ops);

-- These partial B-tree indexes match the export streams' stable cursor order.
-- Without them, each page can repeatedly sort a project's remaining rows.
CREATE INDEX IF NOT EXISTS "breakdown_items_project_position_export_idx"
  ON "breakdown_items" ("project_id", "position", "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "breakdown_items_project_type_position_export_idx"
  ON "breakdown_items" ("project_id", "entity_type_id", "position", "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "field_definitions_project_position_export_idx"
  ON "field_definitions" ("project_id", "position", "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "source_documents_project_export_idx"
  ON "source_documents" ("project_id", "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "storage_objects_project_export_idx"
  ON "storage_objects" ("project_id", "id")
  WHERE "deleted_at" IS NULL;
