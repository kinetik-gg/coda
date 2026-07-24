import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { env } from '../config/env';
import { heartbeatJob } from './built-in-jobs';
import type { JobDefinition } from './job-definition';
import { JobRegistry } from './job-registry';
import { JobRunner } from './job-runner';
import { JobStatusStore } from './job-status-store';

/**
 * Wires registered jobs to timers. Registration (feature modules and the optional heartbeat) happens
 * during module init; the actual scheduling waits for application bootstrap so every module has had
 * the chance to register before any timer is armed.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly registry: JobRegistry,
    private readonly runner: JobRunner,
    private readonly store: JobStatusStore,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const heartbeat = heartbeatJob(env());
    if (heartbeat) this.registry.register(heartbeat);
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const definition of this.registry.all()) {
      await this.arm(definition);
    }
  }

  onModuleDestroy(): void {
    const intervals = new Set(this.schedulerRegistry.getIntervals());
    for (const definition of this.registry.all()) {
      if (intervals.has(definition.key)) this.schedulerRegistry.deleteInterval(definition.key);
    }
  }

  private async arm(definition: JobDefinition): Promise<void> {
    const enabled = definition.enabled !== false;
    const startupTick = enabled && definition.runOnStartup === true;
    const initialNextDue = startupTick ? null : new Date(Date.now() + definition.intervalMs);
    await this.store.ensure(definition.key, enabled, initialNextDue);
    if (!enabled) {
      this.logger.log(`Registered disabled job "${definition.key}" (not scheduled)`);
      return;
    }
    const interval = setInterval(
      () => void this.runner.runJob(definition.key),
      definition.intervalMs,
    );
    this.schedulerRegistry.addInterval(definition.key, interval);
    this.logger.log(`Scheduled job "${definition.key}" every ${definition.intervalMs}ms`);
    if (startupTick) void this.runner.runJob(definition.key);
  }
}
