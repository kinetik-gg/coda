import type { SaveState } from '../workspace/shell';
import styles from './ScreenplayEditorScreen.module.css';

export function ScreenplayEditorNotice({
  status,
  operationError,
  onDismiss,
  onReload,
  onRetry,
}: {
  status: SaveState;
  operationError?: string;
  onDismiss: () => void;
  onReload: () => void;
  onRetry: () => void;
}) {
  if (status !== 'conflict' && status !== 'failed' && !operationError) return null;
  const message =
    operationError ??
    (status === 'conflict'
      ? 'Another session saved a newer version. Your local draft is still here.'
      : 'Coda could not save this draft. Your text remains in the editor.');
  return (
    <aside className={styles.toast} role="alert">
      <span>{message}</span>
      <button
        type="button"
        onClick={operationError ? onDismiss : status === 'conflict' ? onReload : onRetry}
      >
        {operationError ? 'Dismiss' : status === 'conflict' ? 'Reload latest' : 'Try again'}
      </button>
    </aside>
  );
}
