import { useCallback, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importScreenplay as convertScreenplay } from '@coda/fountain';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { FileArrowUpIcon } from '@phosphor-icons/react/dist/csr/FileArrowUp';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { api } from './api';
import { usePublishLibraryTarget, type LibraryTarget } from './app-shell/library-target';
import { downloadFountain } from './screenplays/fountain-download';
import { ScreenplayRenameDialog } from './screenplays/ScreenplayRenameDialog';
import {
  CellIcon,
  Chip,
  ContentListPage,
  DataTable,
  HeaderButton,
  PanelHeader,
  PrimaryText,
  RowStatus,
  StateBlock,
  TimeCell,
  type ContextMenuItem,
  type DataColumn,
} from './content-lists';
import { ScreenplayInspectorSplit } from './screenplays/inspector';
import type { Screenplay, ScreenplaySummary } from './screenplays/types';
import styles from './ScreenplaysScreen.module.css';

const starterText = `Title: Untitled Screenplay
Author:

FADE IN:

INT. LOCATION - DAY

`;

/**
 * Extension point for screenplay row actions still to land (duplicate / exports). No endpoint is
 * invented here: a menu entry appears only when its handler is supplied, so the actions wire in the
 * moment the domain exposes them. Rename, Manage sharing, and Move to trash are now first-class —
 * rename PATCHes the title, Manage sharing opens the management surface, and the trash lifecycle
 * shipped in #148 — and are wired directly below.
 */
export interface ScreenplayRowActions {
  onDuplicate?: (screenplay: ScreenplaySummary) => void;
  onExport?: (screenplay: ScreenplaySummary) => void;
}

/**
 * Navigates to a screenplay management route. The dashboard list mounts deep inside the shell, so it
 * drives the router the same way DataOperationsSection does for breakdowns: a location assign.
 */
function openScreenplayManagement(screenplayId: string) {
  window.location.assign(`/screenplays/${screenplayId}/manage`);
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
    onRename,
    onManage,
    onMoveToTrash,
    trashing,
  }: {
    onOpen: (id: string) => void;
    onRename: (screenplay: ScreenplaySummary) => void;
    onManage: (screenplay: ScreenplaySummary) => void;
    onMoveToTrash: (screenplay: ScreenplaySummary) => void;
    trashing: boolean;
  },
): ContextMenuItem[] {
  return [
    {
      id: 'open',
      label: 'Open',
      icon: ArrowSquareOutIcon,
      onSelect: () => onOpen(screenplay.id),
    },
    {
      id: 'rename',
      label: 'Rename…',
      icon: PencilSimpleIcon,
      onSelect: () => onRename(screenplay),
    },
    {
      id: 'manage',
      label: 'Manage sharing…',
      icon: UsersThreeIcon,
      onSelect: () => onManage(screenplay),
    },
    {
      id: 'trash',
      label: 'Move to trash',
      icon: TrashIcon,
      danger: true,
      disabled: trashing,
      onSelect: () => onMoveToTrash(screenplay),
    },
  ];
}

/**
 * Publishes this surface to the application menu bar, so `File ▸ New Screenplay`, `Import`,
 * `Export`, `Rename`, `Move to Trash`, `Find`, and `Refresh` run the list's own handlers instead of
 * the shell reimplementing them (see `app-shell/library-target`). Everything published here is
 * already reachable from the row menu and the header buttons; the menu bar and ⌘K palette are two
 * more doors onto the same commands.
 */
function useScreenplayLibrary(surface: {
  screenplays: ScreenplaySummary[] | undefined;
  loading: boolean;
  fileInput: RefObject<HTMLInputElement | null>;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (screenplay: ScreenplaySummary) => void;
  refetch: () => void;
  exportScreenplay: (id: string) => void;
  trashScreenplay: (id: string) => void;
}) {
  const { screenplays, loading, fileInput, onOpen, onCreate, onRename } = surface;
  const { refetch, exportScreenplay, trashScreenplay } = surface;
  const target = useMemo<LibraryTarget>(
    () => ({
      noun: 'screenplays',
      singular: 'screenplay',
      loading,
      objects: (screenplays ?? []).map((screenplay) => ({
        id: screenplay.id,
        title: screenplay.title,
        subtitle: screenplay.filename,
      })),
      createItem: onCreate,
      importItem: () => fileInput.current?.click(),
      // The search field belongs to the shared PanelHeader, which owns no ref of its own; the file
      // input is this surface's anchor into that header, so focus is resolved from it rather than
      // from a document-wide query.
      focusSearch: () =>
        fileInput.current
          ?.closest('header')
          ?.querySelector<HTMLInputElement>('input[type="search"]')
          ?.focus(),
      refresh: refetch,
      openObject: onOpen,
      renameObject: (id) => {
        const screenplay = screenplays?.find((candidate) => candidate.id === id);
        if (screenplay) onRename(screenplay);
      },
      exportObject: exportScreenplay,
      trashObject: trashScreenplay,
    }),
    [
      screenplays,
      loading,
      fileInput,
      onOpen,
      onCreate,
      onRename,
      refetch,
      exportScreenplay,
      trashScreenplay,
    ],
  );
  usePublishLibraryTarget(target);
}

export function ScreenplaysScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ScreenplaySummary>();
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
  const rename = useMutation({
    mutationFn: ({ target, title }: { target: ScreenplaySummary; title: string }) =>
      api<Screenplay>(`/api/v1/screenplays/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, version: target.version }),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      queryClient.setQueryData<Screenplay>(['screenplay', updated.id], (current) =>
        current ? { ...current, title: updated.title, version: updated.version } : current,
      );
      setRenaming(undefined);
    },
  });
  // Export reads the full document (the list only carries summaries) and hands it to the shared
  // Fountain download helper the editor's File menu already uses.
  const exportScreenplay = useMutation({
    mutationFn: (id: string) => api<Screenplay>(`/api/v1/screenplays/${id}`),
    onSuccess: (screenplay) => downloadFountain(screenplay.filename, screenplay.sourceText),
  });
  const startCreate = useCallback(() => setCreating(true), []);
  const startRename = useCallback((screenplay: ScreenplaySummary) => setRenaming(screenplay), []);
  useScreenplayLibrary({
    screenplays: screenplays.data,
    loading: screenplays.isLoading,
    fileInput: inputRef,
    onOpen,
    onCreate: startCreate,
    onRename: startRename,
    refetch: screenplays.refetch,
    exportScreenplay: exportScreenplay.mutate,
    trashScreenplay: trash.mutate,
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

  // One builder feeds both the row context menu and the inspector's quick actions, so the two
  // surfaces cannot answer the same question differently.
  const rowMenu = (screenplay: ScreenplaySummary): ContextMenuItem[] =>
    buildRowMenu(screenplay, {
      onOpen,
      onRename: (target) => setRenaming(target),
      onManage: (target) => openScreenplayManagement(target.id),
      onMoveToTrash: (target) => trash.mutate(target.id),
      trashing: trash.isPending && trash.variables === screenplay.id,
    });

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
      {(importError ?? exportScreenplay.error) && (
        <p className={styles.importError} role="alert">
          {importError ?? exportScreenplay.error?.message}
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
        <ScreenplayInspectorSplit rows={rows} buildMenu={rowMenu}>
          {(selection) => (
            <DataTable
              ariaLabel="Screenplays"
              columns={columns}
              gridTemplate="var(--coda-space-6) minmax(0, 1fr) max-content max-content var(--coda-h-menu)"
              rows={rows}
              rowKey={(screenplay) => screenplay.id}
              rowLabel={(screenplay) => screenplay.title}
              onActivate={(screenplay) => onOpen(screenplay.id)}
              buildMenu={rowMenu}
              trailingCell={(screenplay) =>
                trash.isPending && trash.variables === screenplay.id ? (
                  <RowStatus>Removing…</RowStatus>
                ) : null
              }
              {...selection}
            />
          )}
        </ScreenplayInspectorSplit>
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
      {renaming && (
        <ScreenplayRenameDialog
          currentTitle={renaming.title}
          busy={rename.isPending}
          error={rename.error?.message}
          onCancel={() => {
            rename.reset();
            setRenaming(undefined);
          }}
          onSubmit={(title) => rename.mutate({ target: renaming, title })}
        />
      )}
    </ContentListPage>
  );
}
