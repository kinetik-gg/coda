/** A recurring job registered with the scheduler. */
export interface JobDefinition {
  /** Stable identifier. Doubles as the advisory-lock key and the status-table primary key. */
  key: string;
  /** Fixed delay between ticks, in milliseconds. */
  intervalMs: number;
  /** Work to perform on each due tick. Runs at most once per tick across all replicas. */
  handler: () => Promise<void>;
  /** Disabled jobs are tracked in the registry but never scheduled or executed. */
  enabled?: boolean;
  /** Fire one tick immediately at application bootstrap in addition to the interval. */
  runOnStartup?: boolean;
}

export type JobOutcome = 'SUCCESS' | 'FAILURE';

/** A single job's persisted status, as surfaced to operators. */
export interface JobStatus {
  key: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastOutcome: JobOutcome | null;
  lastError: string | null;
  lastDurationMs: number | null;
  lastRunReplica: string | null;
  nextDueAt: Date | null;
  runCount: number;
  failureCount: number;
  updatedAt: Date;
}
