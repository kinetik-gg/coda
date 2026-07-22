CREATE TYPE "ApiCredentialKind" AS ENUM ('API_KEY', 'MCP_TOKEN');

CREATE TABLE "api_credentials" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_by_id" UUID,
    "kind" "ApiCredentialKind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_prefix" VARCHAR(32) NOT NULL,
    "token_last_four" CHAR(4) NOT NULL,
    "permissions" TEXT[] NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_credentials_token_hash_key" ON "api_credentials"("token_hash");
CREATE INDEX "api_credentials_user_id_created_at_idx" ON "api_credentials"("user_id", "created_at");
CREATE INDEX "api_credentials_project_id_revoked_at_expires_at_idx" ON "api_credentials"("project_id", "revoked_at", "expires_at");

ALTER TABLE "api_credentials"
    ADD CONSTRAINT "api_credentials_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "api_credentials"
    ADD CONSTRAINT "api_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "api_credentials"
    ADD CONSTRAINT "api_credentials_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
