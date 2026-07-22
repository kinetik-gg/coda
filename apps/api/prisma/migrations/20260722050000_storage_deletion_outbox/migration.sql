CREATE TABLE "storage_deletion_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "object_key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_deletion_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_deletion_jobs_object_key_key"
ON "storage_deletion_jobs"("object_key");

CREATE INDEX "storage_deletion_jobs_created_at_idx"
ON "storage_deletion_jobs"("created_at");

CREATE INDEX "storage_deletion_jobs_project_id_idx"
ON "storage_deletion_jobs"("project_id");
