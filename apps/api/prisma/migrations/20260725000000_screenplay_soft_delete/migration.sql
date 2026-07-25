-- Additive soft-delete columns bringing screenplays into the trash lifecycle,
-- mirroring the projects/breakdown-items/fields/storage soft-delete shape.
ALTER TABLE "screenplays" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "screenplays" ADD COLUMN "deleted_by_id" UUID;
ALTER TABLE "screenplays" ADD COLUMN "deletion_batch_id" UUID;

CREATE INDEX "screenplays_deleted_at_idx" ON "screenplays"("deleted_at");
