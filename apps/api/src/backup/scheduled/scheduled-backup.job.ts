import { Injectable, type OnModuleInit } from '@nestjs/common';
import { env } from '../../config/env';
import { JobRegistry } from '../../scheduler/job-registry';
import { ScheduledBackupService, SCHEDULED_BACKUP_JOB_KEY } from './scheduled-backup.service';

/**
 * Registers the singleton scheduled-backup job with the scheduler during module
 * init, before the scheduler arms timers at application bootstrap. The job wakes
 * on a fixed poll interval; the run itself self-gates on the operator's enable
 * flag and interval inside {@link ScheduledBackupService.tickJob}.
 */
@Injectable()
export class ScheduledBackupJob implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly service: ScheduledBackupService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      key: SCHEDULED_BACKUP_JOB_KEY,
      intervalMs: env().SCHEDULED_BACKUP_TICK_MS,
      enabled: true,
      runOnStartup: false,
      handler: () => this.service.tickJob(),
    });
  }
}
