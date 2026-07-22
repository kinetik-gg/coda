import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

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
    void this.drain();
    this.timer = setInterval(() => void this.drain(), 60_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(keys?: string[]): Promise<{ deleted: number; pending: number }> {
    if (this.draining) return { deleted: 0, pending: 0 };
    this.draining = true;
    try {
      const jobs = await this.prisma.storageDeletionJob.findMany({
        where: keys?.length ? { objectKey: { in: keys } } : undefined,
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      let deleted = 0;
      for (const job of jobs) {
        try {
          await this.storage.deletePhysical(job.objectKey);
          await this.prisma.storageDeletionJob.delete({ where: { id: job.id } });
          deleted += 1;
        } catch (error) {
          await this.prisma.storageDeletionJob.update({
            where: { id: job.id },
            data: {
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message.slice(0, 1_000) : 'Delete failed',
            },
          });
          this.logger.warn(`Storage deletion remains queued for job ${job.id}`);
        }
      }
      return { deleted, pending: jobs.length - deleted };
    } finally {
      this.draining = false;
    }
  }
}
