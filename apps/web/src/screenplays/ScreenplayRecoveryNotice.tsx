import type { ScreenplayRecoverySnapshot } from './screenplay-recovery-store';
import styles from './ScreenplayRecoveryNotice.module.css';

interface ScreenplayRecoveryNoticeProps {
  recovery?: ScreenplayRecoverySnapshot;
  storageError?: string;
  serverVersion: number;
  onRecover: () => void;
  onDownload: () => void;
  onDiscard: () => void;
  onDismissError: () => void;
}

export function ScreenplayRecoveryNotice({
  recovery,
  storageError,
  serverVersion,
  onRecover,
  onDownload,
  onDiscard,
  onDismissError,
}: ScreenplayRecoveryNoticeProps) {
  if (!recovery && !storageError) return null;
  const serverIsNewer = recovery ? serverVersion > recovery.baseServerVersion : false;
  return (
    <aside
      className={styles.notice}
      role="region"
      aria-label="Screenplay recovery"
      aria-live="polite"
    >
      <div className={styles.copy}>
        <strong>
          {recovery ? 'A browser recovery draft is available' : 'Browser recovery is unavailable'}
        </strong>
        {recovery && (
          <span>
            Saved locally {new Date(recovery.updatedAt).toLocaleString()} from server version{' '}
            {String(recovery.baseServerVersion)}.
            {serverIsNewer
              ? ` The server is now version ${String(serverVersion)}; Coda will not replace it unless you choose Recover.`
              : ' Choose whether to restore or discard it.'}
          </span>
        )}
        {storageError && <small>{storageError}</small>}
      </div>
      <div className={styles.actions}>
        {recovery && (
          <button type="button" onClick={onRecover}>
            Recover
          </button>
        )}
        <button type="button" onClick={onDownload}>
          Download .fountain
        </button>
        {recovery ? (
          <button type="button" onClick={onDiscard}>
            Discard
          </button>
        ) : (
          <button type="button" onClick={onDismissError}>
            Dismiss
          </button>
        )}
      </div>
    </aside>
  );
}
