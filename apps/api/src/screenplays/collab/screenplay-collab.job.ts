import { Injectable, type OnModuleInit } from '@nestjs/common';
import { env } from '../../config/env';
import { JobRegistry } from '../../scheduler/job-registry';
import { ScreenplayCollabCompactionService } from './screenplay-collab-compaction.service';

export const SCREENPLAY_COLLAB_COMPACTION_JOB_KEY = 'collab.compaction';

/**
 * Registers the update-log compaction job with the scheduler during module init, before the
 * scheduler arms timers at bootstrap (ADR: docs/adr-collaboration-engine-and-transport.md,
 * Decision 3 — Compaction). `JobRunner` already runs every tick under
 * `SchedulerAdvisoryLock.runExclusively`, so exactly one replica compacts at a time (and the lock is
 * a no-op on the desktop's single-process scheduler coordination); outcomes land in
 * `scheduled_job_status` like every other job.
 */
@Injectable()
export class ScreenplayCollabJob implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly compaction: ScreenplayCollabCompactionService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      key: SCREENPLAY_COLLAB_COMPACTION_JOB_KEY,
      intervalMs: env().COLLAB_COMPACTION_TICK_MS,
      enabled: true,
      runOnStartup: false,
      handler: async () => {
        await this.compaction.tick();
      },
    });
  }
}
