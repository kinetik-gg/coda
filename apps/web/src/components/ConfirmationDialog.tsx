import { useRef, type ReactNode } from 'react';
import { ModalShell, modalButtonStyles } from './ModalShell';
import styles from './ConfirmationDialog.module.css';

interface ConfirmationDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The confirmation for a destructive action, rendered in the shared modal shell (#169).
 *
 * Cancel takes initial focus and is this dialog's dismissal, so no header close button competes
 * with it. Focus trap and restore, `Escape`, backdrop dismissal, and labelling all come from
 * `ModalShell` — this component decides only the wording and the two actions.
 */
export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  busyLabel = 'Working…',
  busy = false,
  error,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalShell
      title={title}
      description={description}
      busy={busy}
      dismissible={false}
      initialFocus={cancelRef}
      onClose={onCancel}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            className={modalButtonStyles.secondary}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={modalButtonStyles.destructive}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </ModalShell>
  );
}
