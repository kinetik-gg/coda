import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type { StorageMigrationStatus } from '@coda/contracts';
import { api, ApiError } from '../api';
import styles from './MigrationPanel.module.css';

const MIGRATION_PATH = '/api/v1/instance/storage-migration';
const POLL_INTERVAL_MS = 1_500;

const ACTIVE_PHASES: ReadonlySet<StorageMigrationStatus['phase']> = new Set([
  'copying',
  'verifying',
]);

const PHASE_LABEL: Record<StorageMigrationStatus['phase'], string> = {
  idle: 'No migration in progress',
  copying: 'Copying objects to the target',
  verifying: 'Verifying objects against the database',
  verified: 'Verification complete',
  failed: 'Migration failed',
  cutover: 'Cut over to the new backend',
  cancelled: 'Migration cancelled',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Drives and reports an in-flight verified object migration. Polls progress while
 * copying and verifying, renders the verification report, and — only when every
 * object verified cleanly — offers the explicit cutover confirmation. Until the
 * operator confirms, the source backend stays active, so nothing here can strand
 * the instance.
 */
export function MigrationPanel({
  initialStatus,
  onFinished,
}: {
  initialStatus: StorageMigrationStatus;
  onFinished: () => void;
}) {
  const [status, setStatus] = useState<StorageMigrationStatus>(initialStatus);
  const [busy, setBusy] = useState<'idle' | 'cutover' | 'cancel'>('idle');
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const poll = useCallback(async () => {
    try {
      const next = await api<StorageMigrationStatus>(MIGRATION_PATH);
      setStatus(next);
    } catch {
      // Transient poll failures are ignored; the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (!ACTIVE_PHASES.has(statusRef.current.phase)) return;
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll, status.phase]);

  const confirmCutover = async () => {
    setBusy('cutover');
    setError(null);
    try {
      const next = await api<StorageMigrationStatus>(`${MIGRATION_PATH}/cutover`, {
        method: 'POST',
      });
      setStatus(next);
      onFinished();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Cutover could not be completed.');
    } finally {
      setBusy('idle');
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    setError(null);
    try {
      await api<StorageMigrationStatus>(`${MIGRATION_PATH}/cancel`, { method: 'POST' });
      onFinished();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The migration could not be cancelled.');
    } finally {
      setBusy('idle');
    }
  };

  const active = ACTIVE_PHASES.has(status.phase);
  const progress =
    status.phase === 'verifying'
      ? { done: status.verifiedObjects, total: status.totalObjects, label: 'verified' }
      : { done: status.copiedObjects, total: status.totalObjects, label: 'copied' };
  const percent = progress.total === 0 ? 100 : Math.round((progress.done / progress.total) * 100);
  const disabled = busy !== 'idle';

  return (
    <section className={styles.panel} aria-label="Object migration">
      <div className={styles.head}>
        <ArrowRightIcon size={18} aria-hidden="true" />
        <div>
          <h3 className={styles.title}>{PHASE_LABEL[status.phase]}</h3>
          {status.target ? (
            <p className={styles.subtitle}>
              Target bucket <strong>{status.target.bucket}</strong> at {status.target.endpoint}
            </p>
          ) : null}
        </div>
      </div>

      {active ? (
        <div className={styles.progress}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className={styles.progressText}>
            {progress.done} of {progress.total} objects {progress.label} ·{' '}
            {formatBytes(status.copiedBytes)} of {formatBytes(status.totalBytes)}
          </p>
        </div>
      ) : null}

      {status.report ? <Report status={status} /> : null}

      {status.phase === 'failed' && status.error ? (
        <p className={styles.failure} role="alert">
          {status.error}
        </p>
      ) : null}

      {status.phase === 'cutover' ? (
        <p className={styles.success} role="status">
          The instance now reads and writes from the new backend. The old backend was left
          untouched; delete it once you are satisfied.
        </p>
      ) : null}

      {error ? (
        <p className={styles.failure} role="alert">
          {error}
        </p>
      ) : null}

      {status.phase !== 'cutover' ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void confirmCutover()}
            disabled={disabled || !status.canCutover}
          >
            {busy === 'cutover' ? 'Cutting over…' : 'Confirm cutover'}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void cancel()}
            disabled={disabled}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel migration'}
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={onFinished}
            disabled={disabled}
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}

function Report({ status }: { status: StorageMigrationStatus }) {
  const report = status.report;
  if (!report) return null;
  const clean = report.mismatches.length === 0;
  return (
    <div className={styles.report}>
      <div className={styles.reportSummary}>
        {clean ? (
          <CheckCircleIcon size={16} weight="fill" className={styles.ok} aria-hidden="true" />
        ) : (
          <WarningCircleIcon size={16} weight="fill" className={styles.warn} aria-hidden="true" />
        )}
        <span>
          Verified {report.verifiedObjects} of {report.totalObjects} objects (
          {formatBytes(report.totalBytes)}) · {report.mismatches.length} mismatch
          {report.mismatches.length === 1 ? '' : 'es'}
        </span>
      </div>
      {clean ? (
        <p className={styles.reportNote}>
          Every referenced object matched by count, size, and checksum. Cutover is safe.
        </p>
      ) : (
        <ul className={styles.mismatches} aria-label="Verification mismatches">
          {report.mismatches.map((mismatch) => (
            <li key={`${mismatch.kind}:${mismatch.objectKey}`} className={styles.mismatch}>
              <span className={styles.mismatchKind}>{mismatch.kind}</span>
              <span className={styles.mismatchKey}>{mismatch.objectKey}</span>
              <span className={styles.mismatchDetail}>{mismatch.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
