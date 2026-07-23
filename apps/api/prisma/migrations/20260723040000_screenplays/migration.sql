CREATE TABLE "screenplays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "source_text" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "screenplays_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "screenplays_owner_user_id_updated_at_idx"
ON "screenplays"("owner_user_id", "updated_at");

ALTER TABLE "screenplays"
ADD CONSTRAINT "screenplays_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
