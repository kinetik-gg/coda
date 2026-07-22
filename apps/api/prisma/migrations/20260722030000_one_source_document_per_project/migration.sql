CREATE UNIQUE INDEX "source_documents_one_active_per_project_idx"
ON "source_documents" ("project_id")
WHERE "deleted_at" IS NULL;
