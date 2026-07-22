import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importScreenplay as convertScreenplay } from '@coda/fountain';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { FileArrowUpIcon } from '@phosphor-icons/react/dist/csr/FileArrowUp';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { api } from './api';
import type { Screenplay, ScreenplaySummary } from './screenplays/types';
import styles from './ScreenplaysScreen.module.css';

const starterText = `Title: Untitled Screenplay
Author:

FADE IN:

INT. LOCATION - DAY

`;

function ScreenplayDialog({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (cleanTitle) onSubmit(cleanTitle);
  };
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={onCancel}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-screenplay-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form onSubmit={submit}>
          <span className={styles.eyebrow}>NEW DOCUMENT</span>
          <h2 id="new-screenplay-title">Start a screenplay</h2>
          <p>Create a clean Fountain document and begin writing immediately.</p>
          <label>
            <span>Title</span>
            <input
              autoFocus
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Untitled screenplay"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <footer>
            <button type="button" className={styles.secondaryButton} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryButton} disabled={busy || !title.trim()}>
              {busy ? 'Creating…' : 'Create screenplay'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ScreenplayList({
  screenplays,
  onOpen,
}: {
  screenplays: ScreenplaySummary[];
  onOpen: (id: string) => void;
}) {
  if (!screenplays.length) {
    return (
      <section className={styles.empty}>
        <BookOpenTextIcon size={22} aria-hidden="true" />
        <h2>Your first page is waiting.</h2>
        <p>Create a screenplay or bring in an existing Fountain file.</p>
      </section>
    );
  }
  return (
    <section className={styles.list} aria-label="Screenplays">
      {screenplays.map((screenplay) => (
        <button key={screenplay.id} type="button" onClick={() => onOpen(screenplay.id)}>
          <BookOpenTextIcon size={15} aria-hidden="true" />
          <span>
            <strong>{screenplay.title}</strong>
            <small>{screenplay.filename}</small>
          </span>
          <time dateTime={screenplay.updatedAt}>
            {new Date(screenplay.updatedAt).toLocaleDateString()}
          </time>
          <ArrowRightIcon size={13} aria-hidden="true" />
        </button>
      ))}
    </section>
  );
}

export function ScreenplaysScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [importError, setImportError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const screenplays = useQuery({
    queryKey: ['screenplays'],
    queryFn: () => api<ScreenplaySummary[]>('/api/v1/screenplays'),
  });
  const create = useMutation({
    mutationFn: (title: string) =>
      api<Screenplay>('/api/v1/screenplays', {
        method: 'POST',
        body: JSON.stringify({
          title,
          sourceText: starterText.replace('Untitled Screenplay', title),
        }),
      }),
    onSuccess: (screenplay) => {
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      onOpen(screenplay.id);
    },
  });
  const importScreenplay = useMutation({
    mutationFn: ({ filename, sourceText }: { filename: string; sourceText: string }) =>
      api<Screenplay>('/api/v1/screenplays/import', {
        method: 'POST',
        body: JSON.stringify({ filename, sourceText }),
      }),
    onSuccess: (screenplay) => {
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      onOpen(screenplay.id);
    },
    onError: (error) => setImportError(error.message),
  });
  const readImport = async (file?: File) => {
    if (!file) return;
    setImportError(undefined);
    if (!/\.(?:fountain|spmd|txt|fdx|fadein|celtx|mmsw|scw|highland)$/i.test(file.name)) {
      setImportError('Choose a Fountain, Final Draft, or supported screenplay file.');
      return;
    }
    if (file.size > 5_000_000) {
      setImportError('The screenplay file must be smaller than 5 MB.');
      return;
    }
    try {
      const input = /\.fdx$/i.test(file.name)
        ? new Uint8Array(await file.arrayBuffer())
        : await file.text();
      const converted = convertScreenplay(input, { filename: file.name });
      const filename = /\.fdx$/i.test(file.name)
        ? file.name.replace(/\.fdx$/i, '.fountain')
        : file.name;
      importScreenplay.mutate({ filename, sourceText: converted.fountain });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The screenplay could not be read.');
    }
  };

  return (
    <section className={styles.page} aria-busy={screenplays.isLoading}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>WRITING LIBRARY</span>
          <h1>Screenplays</h1>
          <p>Write in Fountain, keep every word portable.</p>
        </div>
        <div className={styles.actions}>
          <input
            ref={inputRef}
            className={styles.fileInput}
            type="file"
            accept=".fountain,.spmd,.txt,.fdx,.fadein,.celtx,.mmsw,.scw,.highland,text/plain,application/xml,text/xml"
            onChange={(event) => {
              void readImport(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={importScreenplay.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <FileArrowUpIcon size={13} aria-hidden="true" />
            {importScreenplay.isPending ? 'Importing…' : 'Import screenplay'}
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => setCreating(true)}>
            <PlusIcon size={13} weight="bold" aria-hidden="true" /> New screenplay
          </button>
        </div>
      </header>
      {importError && (
        <p className={styles.importError} role="alert">
          {importError}
        </p>
      )}
      {screenplays.isLoading ? (
        <div className={styles.loading}>Loading screenplays…</div>
      ) : screenplays.error ? (
        <section className={styles.empty} role="alert">
          <h2>Screenplays could not be loaded.</h2>
          <p>Check the service connection, then try again.</p>
          <button className={styles.secondaryButton} onClick={() => void screenplays.refetch()}>
            Try again
          </button>
        </section>
      ) : (
        <ScreenplayList screenplays={screenplays.data ?? []} onOpen={onOpen} />
      )}
      {creating && (
        <ScreenplayDialog
          busy={create.isPending}
          error={create.error?.message}
          onCancel={() => {
            create.reset();
            setCreating(false);
          }}
          onSubmit={(title) => create.mutate(title)}
        />
      )}
    </section>
  );
}
