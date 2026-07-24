-- Session activity metadata: a throttled last-seen timestamp and a coarse
-- browser/OS class parsed once at session creation. The raw User-Agent header
-- is never persisted. Additive; no existing columns change.
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" TIMESTAMPTZ(3);
ALTER TABLE "sessions" ADD COLUMN "user_agent_class" VARCHAR(64);

UPDATE "sessions" SET "last_seen_at" = "created_at" WHERE "last_seen_at" IS NULL;

ALTER TABLE "sessions" ALTER COLUMN "last_seen_at" SET NOT NULL;
ALTER TABLE "sessions" ALTER COLUMN "last_seen_at" SET DEFAULT CURRENT_TIMESTAMP;
