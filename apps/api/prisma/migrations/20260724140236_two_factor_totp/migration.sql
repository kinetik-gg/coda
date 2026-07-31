-- Two-factor TOTP enrolment, recovery codes, and step-up challenges.
--
-- `_prisma_migrations` travels inside the database dump, so restoring an N-1 backup rewinds the
-- ledger and the next `prisma migrate deploy` runs this file again against the tables it already
-- created (issue #324). Every CREATE here is therefore IF NOT EXISTS, which makes that replay a
-- no-op — including the inline PRIMARY KEY constraints, which a skipped CREATE TABLE never
-- reaches. There is no data backfill in this migration, so nothing else needs a guard.

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_two_factor" (
    "user_id" UUID NOT NULL,
    "secret_ciphertext" BYTEA NOT NULL,
    "secret_nonce" BYTEA NOT NULL,
    "activated_at" TIMESTAMPTZ(3),
    "last_used_counter" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_two_factor_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "two_factor_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_two_factor_recovery_codes_user_id_idx" ON "user_two_factor_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "two_factor_challenges_token_hash_key" ON "two_factor_challenges"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "two_factor_challenges_user_id_idx" ON "two_factor_challenges"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "two_factor_challenges_expires_at_idx" ON "two_factor_challenges"("expires_at");
