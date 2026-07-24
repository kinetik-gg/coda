import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { hostname } from 'node:os';
import { SchedulerAdvisoryLock } from './advisory-lock';
import type { JobDefinition } from './job-definition';
import { JobRegistry } from './job-registry';
import { JobStatusStore } from './job-status-store';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** How a single `runJob` call resolved, for logging and tests. */
export type TickResult =
  | { kind: 'unknown' }
  | { kind: 'disabled' }
  | { kind: 'contended' }
  | { kind: 'not-due' }
  | { kind: 'ran'; outcome: 'SUCCESS' | 'FAILURE' };

/**
 * Executes a single job tick under its advisory lock. Every tick is best-effort: a handler failure
 * is recorded and retried on the next tick, and no failure — handler, lock, or database — is ever
 * allowed to propagate, so a job can never crash the process or affect liveness/readiness.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private readonly replica = process.env.HOSTNAME ?? hostname();

  constructor(
    private readonly registry: JobRegistry,
    private readonly lock: SchedulerAdvisoryLock,
    private readonly store: JobStatusStore,
  ) {}

  async runJob(key: string): Promise<TickResult> {
    const definition = this.registry.get(key);
    if (!definition) {
      this.logger.warn(`Ignoring tick for unregistered job "${key}"`);
      return { kind: 'unknown' };
    }
    if (definition.enabled === false) return { kind: 'disabled' };
    try {
      const attempt = await this.lock.runExclusively(key, (tx) => this.execute(tx, definition));
      if (!attempt.acquired) {
        this.logger.debug(`Skipped "${key}": another replica holds the lock`);
        return { kind: 'contended' };
      }
      return attempt.value;
    } catch (error) {
      // The lock or status write failed. Swallow it: the next tick retries.
      this.logger.error(`Scheduler tick for "${key}" failed to run: ${errorMessage(error)}`);
      return { kind: 'contended' };
    }
  }

  private async execute(
    tx: Prisma.TransactionClient,
    definition: JobDefinition,
  ): Promise<TickResult> {
    const status = await this.store.read(tx, definition.key);
    const now = Date.now();
    if (status?.nextDueAt && now < status.nextDueAt.getTime()) return { kind: 'not-due' };

    let outcome: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
    let error: string | null = null;
    try {
      await definition.handler();
    } catch (handlerError) {
      outcome = 'FAILURE';
      error = errorMessage(handlerError);
      this.logger.error(`Job "${definition.key}" failed: ${error}`);
    }
    await this.store.recordRun(tx, definition.key, {
      outcome,
      error,
      durationMs: Date.now() - now,
      nextDueAt: new Date(Date.now() + definition.intervalMs),
      replica: this.replica,
    });
    return { kind: 'ran', outcome };
  }
}
