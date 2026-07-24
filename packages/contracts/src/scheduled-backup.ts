import { z } from 'zod';
import type { StorageProbeResult, StorageProviderPreset } from './storage-wizard';

// Operator-defined cadence and rolling retention for signed instance backups
// written to object storage under `backups/scheduled/`.

/**
 * Rolling retention policy. `keepLast` is absolute — the newest N archives are
 * never pruned regardless of age. The daily and weekly tiers additionally keep
 * the newest archive of each of the most recent day / 7-day buckets. A non-zero
 * `maxAgeDays` caps the daily and weekly tiers (older tier picks are dropped) but
 * can never remove one of the newest `keepLast`. A zero tier or a zero
 * `maxAgeDays` disables that dimension.
 */
export const scheduledBackupRetentionSchema = z.object({
  keepLast: z.number().int().min(1).max(3_650),
  dailyForDays: z.number().int().min(0).max(3_650),
  weeklyForWeeks: z.number().int().min(0).max(520),
  maxAgeDays: z.number().int().min(0).max(3_650),
});
export type ScheduledBackupRetention = z.infer<typeof scheduledBackupRetentionSchema>;

export const DEFAULT_SCHEDULED_BACKUP_RETENTION: ScheduledBackupRetention = {
  keepLast: 7,
  dailyForDays: 0,
  weeklyForWeeks: 0,
  maxAgeDays: 0,
};

/** Enable flag, cadence in whole hours, and the retention policy. */
export const scheduledBackupSettingsSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(8_760),
  retention: scheduledBackupRetentionSchema,
});
export type ScheduledBackupSettings = z.infer<typeof scheduledBackupSettingsSchema>;

export const DEFAULT_SCHEDULED_BACKUP_SETTINGS: ScheduledBackupSettings = {
  enabled: false,
  intervalHours: 24,
  retention: DEFAULT_SCHEDULED_BACKUP_RETENTION,
};

export const scheduledBackupOutcomeSchema = z.enum(['SUCCESS', 'FAILURE']);
export type ScheduledBackupOutcome = z.infer<typeof scheduledBackupOutcomeSchema>;

/** One recorded scheduled-backup attempt, surfaced as history. */
export interface ScheduledBackupHistoryEntry {
  id: string;
  reason: 'scheduled' | 'manual';
  startedAt: string;
  finishedAt: string;
  outcome: ScheduledBackupOutcome;
  archiveKey: string | null;
  sizeBytes: number | null;
  prunedCount: number;
  error: string | null;
}

/** Where scheduled archives are written. */
export type ScheduledBackupDestinationSource = 'active' | 'override';

/** Redacted view of the destination for the settings screen. */
export interface ScheduledBackupDestinationView {
  source: ScheduledBackupDestinationSource;
  provider: StorageProviderPreset | null;
  endpoint: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
}

/** Live scheduler-derived status for the scheduled-backup job. */
export interface ScheduledBackupStatusView {
  enabled: boolean;
  lastRunAt: string | null;
  lastOutcome: ScheduledBackupOutcome | null;
  lastError: string | null;
  nextDueAt: string | null;
  runCount: number;
  failureCount: number;
}

/** Everything the settings section renders in one read. */
export interface ScheduledBackupView {
  settings: ScheduledBackupSettings;
  destination: ScheduledBackupDestinationView;
  status: ScheduledBackupStatusView;
  verificationKeyFingerprint: string | null;
  history: ScheduledBackupHistoryEntry[];
}

/** Result of a manual "run now" request. */
export interface ScheduledBackupRunResult {
  outcome: ScheduledBackupOutcome;
  entry: ScheduledBackupHistoryEntry;
}

/**
 * Result of applying a dedicated destination override. `invalid` means the probe
 * failed and nothing was saved; `applied` means the override was validated and
 * persisted, and `view` carries the refreshed section state.
 */
export interface ScheduledBackupDestinationResult {
  status: 'applied' | 'invalid';
  probe: StorageProbeResult;
  view?: ScheduledBackupView;
}
