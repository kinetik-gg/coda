ALTER TABLE "storage_deletion_jobs"
ADD COLUMN "not_before" TIMESTAMPTZ(3),
ADD COLUMN "claim_token" UUID,
ADD COLUMN "claimed_at" TIMESTAMPTZ(3);

UPDATE "storage_deletion_jobs"
SET "not_before" = CURRENT_TIMESTAMP + INTERVAL '3601 seconds';

ALTER TABLE "storage_deletion_jobs"
ALTER COLUMN "not_before" SET NOT NULL,
ALTER COLUMN "not_before" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '3601 seconds');

CREATE INDEX "storage_deletion_jobs_not_before_claimed_at_created_at_idx"
ON "storage_deletion_jobs"("not_before", "claimed_at", "created_at");
