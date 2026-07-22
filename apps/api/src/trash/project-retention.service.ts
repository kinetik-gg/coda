import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TrashService } from './trash.service';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

@Injectable()
export class ProjectRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectRetentionService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastStartedAt?: Date;
  private lastCompletedAt?: Date;
  private lastSucceededAt?: Date;
  private lastFailureAt?: Date;
  private lastFailureMessage?: string;
  private lastPurgedProjects = 0;

  constructor(private readonly trash: TrashService) {}

  onModuleInit(): void {
    void this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  status() {
    return {
      id: 'project-retention',
      name: 'Expired project cleanup',
      state: this.running
        ? ('running' as const)
        : this.lastFailureAt
          ? ('degraded' as const)
          : ('idle' as const),
      intervalSeconds: CLEANUP_INTERVAL_MS / 1_000,
      lastStartedAt: this.lastStartedAt ?? null,
      lastCompletedAt: this.lastCompletedAt ?? null,
      lastSucceededAt: this.lastSucceededAt ?? null,
      lastFailureAt: this.lastFailureAt ?? null,
      lastFailureMessage: this.lastFailureMessage ?? null,
      lastPurgedProjects: this.lastPurgedProjects,
      nextRunAt: this.lastStartedAt
        ? new Date(this.lastStartedAt.getTime() + CLEANUP_INTERVAL_MS)
        : null,
    };
  }

  private async cleanup(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastStartedAt = new Date();
    try {
      const count = await this.trash.purgeExpiredProjects();
      this.lastPurgedProjects = count;
      this.lastSucceededAt = new Date();
      this.lastFailureAt = undefined;
      this.lastFailureMessage = undefined;
      if (count > 0) this.logger.log(`Purged ${count} expired trashed project(s)`);
    } catch (error) {
      this.lastFailureAt = new Date();
      this.lastFailureMessage = 'The cleanup job failed; inspect server logs for details.';
      this.logger.error(
        'Expired project cleanup failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.lastCompletedAt = new Date();
      this.running = false;
    }
  }
}
