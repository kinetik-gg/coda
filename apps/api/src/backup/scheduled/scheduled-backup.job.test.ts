import { describe, expect, it, vi } from 'vitest';
import type { JobDefinition } from '../../scheduler/job-definition';

vi.mock('../../config/env', () => ({ env: () => ({ SCHEDULED_BACKUP_TICK_MS: 3_600_000 }) }));

import { ScheduledBackupJob } from './scheduled-backup.job';
import { SCHEDULED_BACKUP_JOB_KEY } from './scheduled-backup.service';

describe('ScheduledBackupJob', () => {
  it('registers a singleton job that delegates ticks to the service', () => {
    const registry = { register: vi.fn() };
    const service = { tickJob: vi.fn().mockResolvedValue(undefined) };
    const job = new ScheduledBackupJob(registry as never, service as never);

    job.onModuleInit();

    expect(registry.register).toHaveBeenCalledTimes(1);
    const definition = registry.register.mock.calls[0]![0] as JobDefinition;
    expect(definition.key).toBe(SCHEDULED_BACKUP_JOB_KEY);
    expect(definition.intervalMs).toBe(3_600_000);
    expect(definition.enabled).toBe(true);
    expect(definition.runOnStartup).toBe(false);

    void definition.handler();
    expect(service.tickJob).toHaveBeenCalledOnce();
  });
});
