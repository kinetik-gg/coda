import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { DatabaseCapabilities, type ClaimedDeletionJob } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { storageDeletionNotBefore, storageDeletionRetryAfter } from './storage-deletion-policy';
import { StorageService } from './storage.service';

const CLEANUP_BATCH_SIZE = 100;

// A crashed worker's claim is reclaimable once it is older than this; matches the historical
// `CURRENT_TIMESTAMP - INTERVAL '5 minutes'` cutoff, now supplied to the database seam.
const STALE_CLAIM_MINUTES = 5;

type DeletionResult = 'deleted' | 'pending' | null;

interface ImportArtifactCandidate {
  id: string;
  screenplayId: string;
  objectKey: string;
}

type ArtifactClaim = (
  tx: Prisma.TransactionClient,
  candidate: ImportArtifactCandidate,
) => Promise<boolean>;

@Injectable()
export class StorageDeletionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StorageDeletionService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;
  private orphanCursor?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly db: DatabaseCapabilities,
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
      await this.queueStaleImportArtifacts();
      await this.queueOrphanedImportArtifacts();
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

  private claimNextEligible(): Promise<ClaimedDeletionJob | null> {
    return this.db.claimNextDeletionJob(STALE_CLAIM_MINUTES);
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

  private async queueStaleImportArtifacts(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - env().STORAGE_UPLOAD_RETENTION_HOURS * 60 * 60 * 1_000);
    const candidates = await this.prisma.screenplayImportArtifact.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, createdAt: { lte: cutoff } },
      select: { id: true, screenplayId: true, objectKey: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: CLEANUP_BATCH_SIZE,
    });
    return this.queueImportArtifacts(candidates, now, async (tx, candidate) => {
      const claimed = await tx.screenplayImportArtifact.deleteMany({
        where: {
          id: candidate.id,
          status: { in: ['PENDING', 'FAILED'] },
          createdAt: { lte: cutoff },
        },
      });
      return claimed.count > 0;
    });
  }

  private async queueOrphanedImportArtifacts(now = new Date()): Promise<number> {
    const candidates = await this.prisma.screenplayImportArtifact.findMany({
      where: this.orphanCursor ? { id: { gt: this.orphanCursor } } : {},
      select: { id: true, screenplayId: true, objectKey: true },
      orderBy: { id: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    });
    this.orphanCursor =
      candidates.length === CLEANUP_BATCH_SIZE ? candidates.at(-1)?.id : undefined;
    return this.queueImportArtifacts(candidates, now, async (tx, candidate) => {
      const screenplay = await tx.screenplay.findUnique({
        where: { id: candidate.screenplayId },
        select: { id: true },
      });
      if (screenplay) return false;
      const claimed = await tx.screenplayImportArtifact.deleteMany({ where: { id: candidate.id } });
      return claimed.count > 0;
    });
  }

  private async queueImportArtifacts(
    candidates: ImportArtifactCandidate[],
    now: Date,
    claim: ArtifactClaim,
  ): Promise<number> {
    if (!candidates.length) return 0;
    const notBefore = storageDeletionNotBefore(now);
    return this.prisma.$transaction(async (tx) => {
      const jobs: Array<{ screenplayId: string; objectKey: string; notBefore: Date }> = [];
      for (const candidate of candidates) {
        if (await claim(tx, candidate)) {
          // `screenplayId` is a real screenplay id, not a project id (issue #283): these jobs have
          // no project at all, so `projectId` stays null rather than borrowing this column.
          jobs.push({
            screenplayId: candidate.screenplayId,
            objectKey: candidate.objectKey,
            notBefore,
          });
        }
      }
      if (jobs.length) {
        await tx.storageDeletionJob.createMany({ data: jobs, skipDuplicates: true });
      }
      return jobs.length;
    });
  }
}
