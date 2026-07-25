import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importScreenplay as convertScreenplay } from '@coda/fountain';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { FileArrowUpIcon } from '@phosphor-icons/react/dist/csr/FileArrowUp';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { api } from './api';
import {
  CellIcon,
  Chip,
  ContentListPage,
  DataTable,
  HeaderButton,
  PanelHeader,
  PrimaryText,
  RowStatus,
  ScrollBody,
  StateBlock,
  TimeCell,
  type ContextMenuItem,
  type DataColumn,
} from './content-lists';
import type { Screenplay, ScreenplaySummary } from './screenplays/types';
import styles from './ScreenplaysScreen.module.css';

const starterText = `Title: Untitled Screenplay
Author:

FADE IN:

INT. LOCATION - DAY

`;

/**
 * Extension point for screenplay row actions still to land (rename / duplicate /
 * exports). No endpoint is invented here: a menu entry appears only when its
 * handler is supplied, so the actions wire in the moment the domain exposes
 * them. Move-to-trash is now first-class — the trash lifecycle shipped in
 * #148 — and is wired directly below.
 */
export interface ScreenplayRowActions {
  onRename?: (screenplay: ScreenplaySummary) => void;
  onDuplicate?: (screenplay: ScreenplaySummary) => void;
  onExport?: (screenplay: ScreenplaySummary) => void;
}

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

const columns: DataColumn<ScreenplaySummary>[] = [
  { key: 'icon', header: '', render: () => <CellIcon icon={BookOpenTextIcon} /> },
  {
    key: 'title',
    header: 'Title',
    render: (screenplay) => <PrimaryText name={screenplay.title} subtitle={screenplay.filename} />,
  },
  {
    key: 'format',
    header: 'Format',
    render: (screenplay) => (
      <Chip title={`Page size ${screenplay.paperSize}`}>{screenplay.paperSize}</Chip>
    ),
  },
  {
    key: 'updated',
    header: 'Updated',
    numeric: true,
    render: (screenplay) => <TimeCell iso={screenplay.updatedAt} />,
  },
];

function buildRowMenu(
  screenplay: ScreenplaySummary,
  {
    onOpen,
    onMoveToTrash,
    trashing,
    rowActions,
  }: {
    onOpen: (id: string) => void;
    onMoveToTrash: (screenplay: ScreenplaySummary) => void;
    trashing: boolean;
    rowActions?: ScreenplayRowActions;
  },
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      id: 'open',
      label: 'Open',
      icon: ArrowSquareOutIcon,
      onSelect: () => onOpen(screenplay.id),
    },
  ];
  if (rowActions?.onRename) {
    items.push({
      id: 'rename',
      label: 'Rename…',
      icon: PencilSimpleIcon,
      onSelect: () => rowActions.onRename?.(screenplay),
    });
  }
  items.push({
    id: 'trash',
    label: 'Move to trash',
    icon: TrashIcon,
    danger: true,
    disabled: trashing,
    onSelect: () => onMoveToTrash(screenplay),
  });
  return items;
}

export function ScreenplaysScreen({
  onOpen,
  rowActions,
}: {
  onOpen: (id: string) => void;
  rowActions?: ScreenplayRowActions;
}) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
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
  const trash = useMutation({
    mutationFn: (id: string) => api(`/api/v1/screenplays/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-screenplays'] });
    },
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
      const input = new Uint8Array(await file.arrayBuffer());
      const converted = convertScreenplay(input, { filename: file.name });
      const filename = /\.fdx$/i.test(file.name)
        ? file.name.replace(/\.fdx$/i, '.fountain')
        : file.name;
      importScreenplay.mutate({ filename, sourceText: converted.fountain });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The screenplay could not be read.');
    }
  };

  const all = screenplays.data ?? [];
  const rows = useMemo(() => {
    const data = screenplays.data ?? [];
    const term = query.trim().toLowerCase();
    if (!term) return data;
    return data.filter(
      (screenplay) =>
        screenplay.title.toLowerCase().includes(term) ||
        screenplay.filename.toLowerCase().includes(term),
    );
  }, [screenplays.data, query]);

  return (
    <ContentListPage busy={screenplays.isLoading}>
      <PanelHeader
        title="Screenplays"
        count={all.length}
        search={{ value: query, onChange: setQuery, label: 'Search screenplays' }}
        actions={
          <>
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
            <HeaderButton
              disabled={importScreenplay.isPending}
              onClick={() => inputRef.current?.click()}
            >
              <FileArrowUpIcon size={12} aria-hidden="true" />
              {importScreenplay.isPending ? 'Importing…' : 'Import'}
            </HeaderButton>
            <HeaderButton primary onClick={() => setCreating(true)}>
              <PlusIcon size={12} weight="bold" aria-hidden="true" /> New screenplay
            </HeaderButton>
          </>
        }
      />
      {importError && (
        <p className={styles.importError} role="alert">
          {importError}
        </p>
      )}
      {screenplays.isLoading ? (
        <StateBlock message="Loading screenplays…" />
      ) : screenplays.error ? (
        <StateBlock
          alert
          message="Screenplays could not be loaded. Check the service connection, then try again."
          action={{ label: 'Try again', onClick: () => void screenplays.refetch() }}
        />
      ) : all.length === 0 ? (
        <StateBlock
          message="Your first page is waiting — create a screenplay or import a Fountain file to begin."
          action={{ label: 'Create a screenplay', onClick: () => setCreating(true), primary: true }}
        />
      ) : rows.length === 0 ? (
        <StateBlock message={`No screenplays match “${query}”.`} />
      ) : (
        <ScrollBody>
          <DataTable
            ariaLabel="Screenplays"
            columns={columns}
            gridTemplate="var(--coda-space-6) minmax(0, 1fr) max-content max-content var(--coda-h-menu)"
            rows={rows}
            rowKey={(screenplay) => screenplay.id}
            rowLabel={(screenplay) => screenplay.title}
            onActivate={(screenplay) => onOpen(screenplay.id)}
            buildMenu={(screenplay) =>
              buildRowMenu(screenplay, {
                onOpen,
                onMoveToTrash: (target) => trash.mutate(target.id),
                trashing: trash.isPending && trash.variables === screenplay.id,
                rowActions,
              })
            }
            trailingCell={(screenplay) =>
              trash.isPending && trash.variables === screenplay.id ? (
                <RowStatus>Removing…</RowStatus>
              ) : null
            }
          />
        </ScrollBody>
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
    </ContentListPage>
  );
}
