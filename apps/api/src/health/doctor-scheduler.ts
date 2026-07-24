/** Health verdict shared by every doctor row and by scheduler-provider snapshots. */
export type DoctorRowStatus = 'ok' | 'warn' | 'error' | 'unknown';

/**
 * Extension point for the scheduled-job status table tracked by issue #89.
 * That module has not landed on `main` yet, so the doctor report has nothing
 * to read: {@link DoctorService} injects this token optionally and reports a
 * defensive "not available" row when nothing is bound.
 *
 * Once #89 ships, it registers a `SchedulerHealthProvider` implementation
 * under this token in `AppModule` (mirroring how `BackupService` accepts
 * `BACKUP_ADAPTERS`) and the scheduler row starts reporting real last/next
 * run data with no further changes to this module.
 */
export const SCHEDULER_HEALTH_PROVIDER = Symbol('SCHEDULER_HEALTH_PROVIDER');

export interface SchedulerHealthSnapshot {
  status: DoctorRowStatus;
  value: string;
  hint: string | null;
}

export interface SchedulerHealthProvider {
  status(): Promise<SchedulerHealthSnapshot> | SchedulerHealthSnapshot;
}
