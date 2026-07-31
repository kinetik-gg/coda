-- Range-anchored screenplay comment threads. These tables deliberately have no
-- foreign keys onto screenplays or users: an N-1 dump does not know about them,
-- so dependencies onto core objects would block pg_restore --clean.
--
-- Because `_prisma_migrations` travels inside the dump, this file runs again after a restore
-- (issue #324). CREATE ... IF NOT EXISTS makes that replay a no-op, including for the inline
-- PRIMARY KEY, CHECK, and FOREIGN KEY constraints. The thread_id foreign key is declared inside
-- the CREATE TABLE rather than as a trailing ALTER TABLE ... ADD CONSTRAINT, because Postgres has
-- no `ADD CONSTRAINT IF NOT EXISTS`; it creates exactly the same constraint, under exactly the
-- same name, and matches how every other appended table declares its intra-group foreign keys
-- (screenplay_role_permissions, space_resources, ...).
CREATE TABLE IF NOT EXISTS "screenplay_comment_threads" (
    "id" UUID NOT NULL,
    "screenplay_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "anchor_start" BYTEA NOT NULL,
    "anchor_end" BYTEA NOT NULL,
    "quoted_text" VARCHAR(512) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "screenplay_comment_threads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screenplay_comment_threads_status_check"
      CHECK ("status" IN ('OPEN', 'RESOLVED'))
);

CREATE INDEX IF NOT EXISTS "screenplay_comment_threads_screenplay_id_status_idx"
  ON "screenplay_comment_threads"("screenplay_id", "status");

CREATE TABLE IF NOT EXISTS "screenplay_comments" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "screenplay_comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screenplay_comments_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "screenplay_comment_threads"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "screenplay_comments_thread_id_created_at_idx"
  ON "screenplay_comments"("thread_id", "created_at");
