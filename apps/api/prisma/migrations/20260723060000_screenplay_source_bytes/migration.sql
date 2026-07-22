ALTER TABLE "screenplays"
ADD COLUMN "source_byte_length" INTEGER NOT NULL DEFAULT 0;

UPDATE "screenplays"
SET "source_byte_length" = octet_length("source_text");

ALTER TABLE "screenplays"
ADD CONSTRAINT "screenplays_source_byte_length_nonnegative"
CHECK ("source_byte_length" >= 0);
