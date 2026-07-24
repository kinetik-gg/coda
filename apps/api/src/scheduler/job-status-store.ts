import { Injectable } from '@nestjs/common';
import type { Prisma, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { JobStatus } from './job-definition';

const MAX_ERROR_LENGTH = 2_000;

/** A recorded tick outcome, written atomically while the job's advisory lock is held. */
export interface RunRecord {
  outcome: 'SUCCESS' | 'FAILURE';
  error: string | null;
  durationMs: number;
  nextDueAt: Date;
  replica: string;
}

function toStatus(row: ScheduledJobStatus): JobStatus {
  return {
    key: row.key,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastOutcome: row.lastOutcome,
    lastError: row.lastError,
    lastDurationMs: row.lastDurationMs,
    lastRunReplica: row.lastRunReplica,
    nextDueAt: row.nextDueAt,
    runCount: row.runCount,
    failureCount: row.failureCount,
    updatedAt: row.updatedAt,
  };
}

/** Reads and writes durable per-job status in the `scheduled_job_status` table. */
@Injectable()
export class JobStatusStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the status row if absent, seeding the initial next-due time. An existing row keeps its
   * runtime state (counters, last run, claimed next-due) so a restarting or racing replica never
   * rewinds a tick another replica already claimed; only the enabled flag is reconciled.
   */
  async ensure(key: string, enabled: boolean, nextDueAt: Date | null): Promise<void> {
    await this.prisma.scheduledJobStatus.upsert({
      where: { key },
      create: { key, enabled, nextDueAt },
      update: { enabled },
    });
  }

  /** Reads the current row while the caller holds the job's advisory lock. */
  read(tx: Prisma.TransactionClient, key: string): Promise<ScheduledJobStatus | null> {
    return tx.scheduledJobStatus.findUnique({ where: { key } });
  }

  /** Records a completed tick, advancing counters and the next-due time. */
  async recordRun(tx: Prisma.TransactionClient, key: string, record: RunRecord): Promise<void> {
    const failed = record.outcome === 'FAILURE';
    await tx.scheduledJobStatus.update({
      where: { key },
      data: {
        lastRunAt: new Date(),
        lastOutcome: record.outcome,
        lastError: failed ? (record.error ?? 'Unknown error').slice(0, MAX_ERROR_LENGTH) : null,
        lastDurationMs: record.durationMs,
        lastRunReplica: record.replica,
        nextDueAt: record.nextDueAt,
        runCount: { increment: 1 },
        failureCount: failed ? { increment: 1 } : undefined,
      },
    });
  }

  async get(key: string): Promise<JobStatus | null> {
    const row = await this.prisma.scheduledJobStatus.findUnique({ where: { key } });
    return row ? toStatus(row) : null;
  }

  async list(): Promise<JobStatus[]> {
    const rows = await this.prisma.scheduledJobStatus.findMany({ orderBy: { key: 'asc' } });
    return rows.map(toStatus);
  }
}
