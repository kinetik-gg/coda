-- Singleton job scheduler: durable per-job status (last run, outcome, next due) for the
-- advisory-lock leader-elected scheduler. Job status is operational metadata, not secret, so it
-- lives in a plain table. Additive migration; introduces no changes to existing objects.

-- CreateEnum
CREATE TYPE "JobOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "scheduled_job_status" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMPTZ(3),
    "last_outcome" "JobOutcome",
    "last_error" TEXT,
    "last_duration_ms" INTEGER,
    "last_run_replica" TEXT,
    "next_due_at" TIMESTAMPTZ(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scheduled_job_status_pkey" PRIMARY KEY ("key")
);
