import { useState, type FormEvent } from 'react';
import styles from './ScreenplayRenameDialog.module.css';

/**
 * A focused single-field dialog for renaming a screenplay, shared by the list row menu and the
 * editor's File menu. It owns only the draft title; the caller supplies the mutation state.
 */
export function ScreenplayRenameDialog({
  currentTitle,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  currentTitle: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState(currentTitle);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (cleanTitle && cleanTitle !== currentTitle) onSubmit(cleanTitle);
  };
  const cleanTitle = title.trim();
  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onCancel}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-screenplay-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form onSubmit={submit}>
          <span className={styles.eyebrow}>RENAME</span>
          <h2 id="rename-screenplay-title">Rename screenplay</h2>
          <label className={styles.field}>
            <span>Title</span>
            <input
              autoFocus
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <footer className={styles.footer}>
            <button type="button" className={styles.secondaryButton} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={busy || !cleanTitle || cleanTitle === currentTitle}
            >
              {busy ? 'Renaming…' : 'Rename'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
