import { Injectable } from '@nestjs/common';
import type { JobDefinition } from './job-definition';

/**
 * In-memory catalogue of the jobs the scheduler knows about. Feature modules register their jobs
 * during module initialization; the scheduler schedules everything registered here once the
 * application has finished bootstrapping.
 */
@Injectable()
export class JobRegistry {
  private readonly jobs = new Map<string, JobDefinition>();

  register(definition: JobDefinition): void {
    if (!definition.key.trim()) throw new Error('A scheduled job requires a non-empty key');
    if (this.jobs.has(definition.key)) {
      throw new Error(`A scheduled job named "${definition.key}" is already registered`);
    }
    if (!Number.isInteger(definition.intervalMs) || definition.intervalMs <= 0) {
      throw new Error(`Scheduled job "${definition.key}" requires a positive interval`);
    }
    this.jobs.set(definition.key, { enabled: true, runOnStartup: false, ...definition });
  }

  get(key: string): JobDefinition | undefined {
    return this.jobs.get(key);
  }

  all(): JobDefinition[] {
    return [...this.jobs.values()];
  }
}
