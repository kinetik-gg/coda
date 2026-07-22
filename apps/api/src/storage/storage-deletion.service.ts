import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { storageDeletionNotBefore, storageDeletionRetryAfter } from './storage-deletion-policy';
import { StorageService } from './storage.service';

const CLEANUP_BATCH_SIZE = 100;

interface ClaimedDeletionJob {
  id: string;
  objectKey: string;
  attempts: number;
  claimToken: string;
}

type DeletionResult = 'deleted' | 'pending' | null;

@Injectable()
export class StorageDeletionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StorageDeletionService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap(): void {
    this.triggerDrain();
    this.timer = setInterval(() => this.triggerDrain(), 60_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<{ deleted: number; pending: number }> {
    if (this.draining) return { deleted: 0, pending: 0 };
    this.draining = true;
    try {
      await this.queueStaleUploads();
      let deleted = 0;
      let pending = 0;
      for (let index = 0; index < CLEANUP_BATCH_SIZE; index += 1) {
        const result = await this.deleteNextEligible();
        if (!result) break;
        if (result === 'deleted') deleted += 1;
        else pending += 1;
      }
      return { deleted, pending };
    } finally {
      this.draining = false;
    }
  }

  triggerDrain(): void {
    void this.drain().catch((error: unknown) => {
      this.logger.error(
        'Storage deletion drain failed',
        error instanceof Error ? error.stack : undefined,
      );
    });
  }

  private async deleteNextEligible(): Promise<DeletionResult> {
    const job = await this.claimNextEligible();
    if (!job) return null;
    try {
      await this.storage.deletePhysical(job.objectKey);
      const removed = await this.prisma.storageDeletionJob.deleteMany({
        where: { id: job.id, claimToken: job.claimToken },
      });
      return removed.count ? 'deleted' : 'pending';
    } catch (error) {
      await this.prisma.storageDeletionJob.updateMany({
        where: { id: job.id, claimToken: job.claimToken },
        data: {
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message.slice(0, 1_000) : 'Delete failed',
          notBefore: storageDeletionRetryAfter(job.attempts + 1),
          claimToken: null,
          claimedAt: null,
        },
      });
      this.logger.warn(`Storage deletion remains queued for job ${job.id}`);
      return 'pending';
    }
  }

  private async claimNextEligible(): Promise<ClaimedDeletionJob | null> {
    const claimToken = randomUUID();
    const claimed = await this.prisma.$queryRaw<
      Array<Omit<ClaimedDeletionJob, 'claimToken'>>
    >(Prisma.sql`
      UPDATE "storage_deletion_jobs"
      SET
        "claim_token" = CAST(${claimToken} AS UUID),
        "claimed_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = (
        SELECT "id"
        FROM "storage_deletion_jobs"
        WHERE "not_before" <= CURRENT_TIMESTAMP
          AND (
            "claimed_at" IS NULL
            OR "claimed_at" <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id", "object_key" AS "objectKey", "attempts"
    `);
    return claimed[0] ? { ...claimed[0], claimToken } : null;
  }

  private async queueStaleUploads(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - env().STORAGE_UPLOAD_RETENTION_HOURS * 60 * 60 * 1_000);
    const candidates = await this.prisma.storageObject.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        createdAt: { lte: cutoff },
      },
      select: { id: true, projectId: true, objectKey: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: CLEANUP_BATCH_SIZE,
    });
    if (!candidates.length) return 0;
    const notBefore = storageDeletionNotBefore(now);
    return this.prisma.$transaction(async (tx) => {
      let queued = 0;
      for (const candidate of candidates) {
        const claimed = await tx.storageObject.deleteMany({
          where: {
            id: candidate.id,
            status: { in: ['PENDING', 'FAILED'] },
            createdAt: { lte: cutoff },
          },
        });
        if (!claimed.count) continue;
        await tx.storageDeletionJob.createMany({
          data: [
            {
              projectId: candidate.projectId,
              objectKey: candidate.objectKey,
              notBefore,
            },
          ],
          skipDuplicates: true,
        });
        queued += 1;
      }
      return queued;
    });
  }
}
