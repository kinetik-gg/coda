-- Account-scoped progressive login backoff: persistent per-account failed-attempt tracking.
ALTER TABLE "users"
ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "login_locked_until" TIMESTAMPTZ(3);
