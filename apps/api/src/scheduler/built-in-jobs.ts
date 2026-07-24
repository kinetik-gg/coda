import type { Env } from '../config/env';
import type { JobDefinition } from './job-definition';

export const HEARTBEAT_JOB_KEY = 'scheduler.heartbeat';

/**
 * An optional self-check job. Its execution is its own evidence: each tick advances the job's run
 * count in the status table, which proves the scheduler loop is alive and — with multiple replicas —
 * that a tick runs exactly once cluster-wide. Disabled by default; enabled for the dual-replica
 * deployment proof and available to operators who want a scheduler liveness signal.
 */
export function heartbeatJob(config: Env): JobDefinition | null {
  if (!config.SCHEDULER_HEARTBEAT_ENABLED) return null;
  return {
    key: HEARTBEAT_JOB_KEY,
    intervalMs: config.SCHEDULER_HEARTBEAT_INTERVAL_MS,
    runOnStartup: true,
    handler: () => Promise.resolve(),
  };
}
