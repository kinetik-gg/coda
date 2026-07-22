CREATE TABLE "screenplay_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "screenplay_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "screenplay_version" INTEGER NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "source_text" TEXT NOT NULL,
    "source_byte_length" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screenplay_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screenplay_revisions_version_positive" CHECK ("screenplay_version" >= 1),
    CONSTRAINT "screenplay_revisions_source_byte_length_nonnegative"
      CHECK ("source_byte_length" >= 0),
    CONSTRAINT "screenplay_revisions_source_byte_length_exact"
      CHECK ("source_byte_length" = octet_length("source_text"))
);

CREATE UNIQUE INDEX "screenplay_revisions_screenplay_id_screenplay_version_key"
ON "screenplay_revisions"("screenplay_id", "screenplay_version");

CREATE UNIQUE INDEX "screenplays_id_owner_user_id_key"
ON "screenplays"("id", "owner_user_id");

CREATE INDEX "screenplay_revisions_owner_user_id_created_at_idx"
ON "screenplay_revisions"("owner_user_id", "created_at");

CREATE INDEX "screenplay_revisions_screenplay_id_created_at_idx"
ON "screenplay_revisions"("screenplay_id", "created_at");

ALTER TABLE "screenplay_revisions"
ADD CONSTRAINT "screenplay_revisions_screenplay_id_owner_user_id_fkey"
FOREIGN KEY ("screenplay_id", "owner_user_id") REFERENCES "screenplays"("id", "owner_user_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screenplay_revisions"
ADD CONSTRAINT "screenplay_revisions_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_screenplay_revision_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'screenplay revisions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER screenplay_revisions_immutable
BEFORE UPDATE ON "screenplay_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_screenplay_revision_update();
