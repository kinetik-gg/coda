import { useState } from 'react';
import { ModalShell, modalButtonStyles, modalFormStyles } from '../components/ModalShell';

/**
 * A focused single-field dialog for renaming a screenplay, shared by the list row menu, the
 * inspector's quick actions, and the editor's File menu. It owns only the draft title; the caller
 * supplies the mutation state. Chrome and focus behaviour come from the shared `ModalShell` (#169).
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
  const cleanTitle = title.trim();
  const submittable = Boolean(cleanTitle) && cleanTitle !== currentTitle;
  return (
    <ModalShell
      eyebrow="Rename"
      title="Rename screenplay"
      busy={busy}
      onClose={onCancel}
      onSubmit={() => {
        if (submittable) onSubmit(cleanTitle);
      }}
      footer={
        <>
          <button type="button" className={modalButtonStyles.secondary} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={modalButtonStyles.primary}
            disabled={busy || !submittable}
          >
            {busy ? 'Renaming…' : 'Rename'}
          </button>
        </>
      }
    >
      <label className={modalFormStyles.field}>
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
        <p className={modalFormStyles.error} role="alert">
          {error}
        </p>
      )}
    </ModalShell>
  );
}
