import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { api } from '../api';
import { FountainEditor } from './FountainEditor';
import { downloadFountain } from './fountain-download';
import type { SaveStatus, Screenplay } from './types';
import { useScreenplayAutosave } from './useScreenplayAutosave';
import styles from './ScreenplayEditorScreen.module.css';

const statusLabels: Record<SaveStatus, string> = {
  conflict: 'Save conflict',
  failed: 'Save failed',
  offline: 'Offline — changes kept here',
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
};

function ScreenplayEditor({
  screenplayId,
  screenplay,
  onBack,
}: {
  screenplayId: string;
  screenplay: Screenplay;
  onBack: () => void;
}) {
  const autosave = useScreenplayAutosave(screenplayId, screenplay);
  const leave = async () => {
    if (await autosave.persist()) onBack();
  };
  return (
    <main className={styles.screen}>
      <header className={styles.toolbar}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Back to screenplays"
          onClick={() => void leave()}
        >
          <ArrowLeftIcon size={15} aria-hidden="true" />
        </button>
        <div className={styles.identity}>
          <strong>{screenplay.title}</strong>
          <span>{screenplay.filename}</span>
        </div>
        <span className={`${styles.saveStatus} ${styles[autosave.status]}`} aria-live="polite">
          {statusLabels[autosave.status]}
        </span>
        <button
          type="button"
          className={styles.download}
          onClick={() => downloadFountain(screenplay.filename, autosave.draft)}
        >
          <DownloadSimpleIcon size={14} aria-hidden="true" /> Download Fountain
        </button>
      </header>
      {autosave.status === 'conflict' && (
        <aside className={styles.conflict} role="alert">
          <span>Another session saved a newer version. Your local draft is still here.</span>
          <button type="button" onClick={() => void autosave.reloadLatest()}>
            Reload latest
          </button>
        </aside>
      )}
      {autosave.status === 'failed' && (
        <aside className={styles.conflict} role="alert">
          <span>Coda could not save this draft. Your text remains in the editor.</span>
          <button type="button" onClick={() => void autosave.persist()}>
            Try again
          </button>
        </aside>
      )}
      <section className={styles.editor}>
        <FountainEditor
          value={autosave.draft}
          onChange={autosave.setDraft}
          onSave={autosave.persist}
        />
      </section>
      <footer className={styles.footer}>
        <span>FOUNTAIN 1.1</span>
        <span>{autosave.draft.split('\n').length.toLocaleString()} lines</span>
        <span>Press Ctrl/Cmd+S to save now</span>
      </footer>
    </main>
  );
}

export function ScreenplayEditorScreen({
  screenplayId,
  onBack,
}: {
  screenplayId: string;
  onBack: () => void;
}) {
  const screenplay = useQuery({
    queryKey: ['screenplay', screenplayId],
    queryFn: () => api<Screenplay>(`/api/v1/screenplays/${screenplayId}`),
  });
  if (screenplay.isLoading) return <main className={styles.state}>Opening screenplay…</main>;
  if (!screenplay.data) {
    return (
      <main className={styles.state} role="alert">
        <strong>Screenplay could not be opened.</strong>
        <button type="button" onClick={onBack}>
          Back to screenplays
        </button>
      </main>
    );
  }
  return (
    <ScreenplayEditor screenplayId={screenplayId} screenplay={screenplay.data} onBack={onBack} />
  );
}
