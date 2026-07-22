CREATE TABLE "project_workspace_defaults" (
  "project_id" UUID PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "layout" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "published_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "published_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_workspace_defaults_schema_version_check"
    CHECK ("schema_version" > 0 AND "layout" ? 'schemaVersion' AND ("layout"->>'schemaVersion')::INTEGER = "schema_version"),
  CONSTRAINT "project_workspace_defaults_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "project_workspace_defaults_layout_size_check" CHECK (octet_length("layout"::TEXT) <= 65536)
);

CREATE INDEX "project_workspace_defaults_published_by_id_idx"
  ON "project_workspace_defaults"("published_by_id");

CREATE TABLE "project_membership_workspace_layouts" (
  "membership_id" UUID PRIMARY KEY REFERENCES "project_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "layout" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "based_on_default_revision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_membership_workspace_layouts_schema_version_check"
    CHECK ("schema_version" > 0 AND "layout" ? 'schemaVersion' AND ("layout"->>'schemaVersion')::INTEGER = "schema_version"),
  CONSTRAINT "project_membership_workspace_layouts_revision_check"
    CHECK ("revision" >= 0 AND "based_on_default_revision" >= 0),
  CONSTRAINT "project_membership_workspace_layouts_layout_size_check"
    CHECK (octet_length("layout"::TEXT) <= 65536)
);

INSERT INTO "project_workspace_defaults" (
  "project_id", "layout", "schema_version", "revision", "published_at", "created_at", "updated_at"
)
SELECT
  "id",
  '{
    "schemaVersion": 1,
    "root": {
      "kind": "split",
      "id": "10000000-0000-4000-8000-000000000001",
      "axis": "horizontal",
      "ratioBasisPoints": 7000,
      "first": {
        "kind": "panel",
        "id": "10000000-0000-4000-8000-000000000002",
        "panel": {
          "id": "20000000-0000-4000-8000-000000000001",
          "type": "entity_table",
          "configVersion": 1,
          "config": {"entityTypeId": null, "search": "", "sort": "manual", "direction": "asc", "filters": []}
        }
      },
      "second": {
        "kind": "split",
        "id": "10000000-0000-4000-8000-000000000003",
        "axis": "vertical",
        "ratioBasisPoints": 5500,
        "first": {
          "kind": "panel",
          "id": "10000000-0000-4000-8000-000000000004",
          "panel": {
            "id": "20000000-0000-4000-8000-000000000002",
            "type": "pdf",
            "configVersion": 1,
            "config": {"sourceDocumentId": null, "page": 1, "zoom": 1}
          }
        },
        "second": {
          "kind": "panel",
          "id": "10000000-0000-4000-8000-000000000005",
          "panel": {
            "id": "20000000-0000-4000-8000-000000000003",
            "type": "inspector",
            "configVersion": 1,
            "config": {"section": "details"}
          }
        }
      }
    }
  }'::JSONB,
  1,
  0,
  "created_at",
  "created_at",
  "updated_at"
FROM "projects";

INSERT INTO "project_membership_workspace_layouts" (
  "membership_id", "layout", "schema_version", "based_on_default_revision", "revision", "created_at", "updated_at"
)
SELECT
  membership."id",
  published_default."layout",
  published_default."schema_version",
  published_default."revision",
  0,
  membership."created_at",
  membership."created_at"
FROM "project_memberships" membership
JOIN "project_workspace_defaults" published_default
  ON published_default."project_id" = membership."project_id";
