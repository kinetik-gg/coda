-- Singleton table for the release-checker service: latest-known upstream release and last poll
-- outcome. Plain, non-secret operational state; deliberately independent of the encrypted
-- instance-config store.
CREATE TABLE "release_check_state" (
  "id" VARCHAR(16) NOT NULL DEFAULT 'singleton',
  "latest_version" VARCHAR(64),
  "latest_image" TEXT,
  "latest_digest" VARCHAR(128),
  "latest_bundle_sha256" VARCHAR(64),
  "notes_url" TEXT,
  "last_checked_at" TIMESTAMPTZ(3),
  "last_succeeded_at" TIMESTAMPTZ(3),
  "last_error_at" TIMESTAMPTZ(3),
  "last_error_message" TEXT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "release_check_state_pkey" PRIMARY KEY ("id")
);
