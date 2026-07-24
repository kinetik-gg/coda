-- Encrypted instance configuration store: one row per key holding AES-256-GCM
-- ciphertext plus its per-write nonce. Additive; introduces no changes to
-- existing tables.
CREATE TABLE "instance_config" (
    "key" VARCHAR(120) NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "instance_config_pkey" PRIMARY KEY ("key")
);
