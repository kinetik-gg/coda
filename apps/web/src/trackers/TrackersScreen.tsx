import { useCallback, useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { createTracker, listTrackers, renameTracker, trashTracker } from '../api';
import { usePublishLibraryTarget, type LibraryTarget } from '../app-shell/library-target';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { ModalShell, modalButtonStyles, modalFormStyles } from '../components/ModalShell';
import { moveToSpaceMenuItem } from '../spaces/move-to-space-menu';
import { MoveToSpaceDialog } from '../spaces/MoveToSpaceDialog';
import { TrackerShareDialog } from './management/TrackerShareDialog';
import {
  HeaderButton,
  LibraryEmpty,
  LibraryList,
  LibraryPage,
  SurfaceContextMenu,
  type ContextMenuItem,
  type LibraryItem,
} from '../content-lists';
import { relativeTime } from '../content-lists/relative-time';
import type { TrackerSummary } from './types';

function TrackerNameDialog({
  dialogTitle,
  submitLabel,
  busyLabel,
  initialName,
  description,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  dialogTitle: string;
  submitLabel: string;
  busyLabel: string;
  /** Prefills the field for rename; create starts empty. */
  initialName?: string;
  description?: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName ?? '');
  const cleanName = name.trim();
  const submittable = Boolean(cleanName) && cleanName !== initialName;
  return (
    <ModalShell
      config={{
        regions: {
          header: { title: dialogTitle },
          body: {
            ...(description ? { description } : {}),
            content: (
              <>
                <label className={modalFormStyles.field}>
                  <span>Name</span>
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Untitled tracker"
                  />
                </label>
                {error && (
                  <p className={modalFormStyles.error} role="alert">
                    {error}
                  </p>
                )}
              </>
            ),
          },
          footer: (
            <>
              <button type="button" className={modalButtonStyles.secondary} onClick={onCancel}>
                Cancel
              </button>
              <button
                type="submit"
                className={modalButtonStyles.primary}
                disabled={busy || !submittable}
              >
                {busy ? busyLabel : submitLabel}
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onCancel, busy },
        form: {
          onSubmit: () => {
            if (submittable) onSubmit(cleanName);
          },
        },
      }}
    />
  );
}

/**
 * Every dialog the library can present: create, rename, share, move-to-space, and the
 * move-to-trash confirmation. Hoisted so the surface stays within the maintainability budget and
 * the one place dialogs are declared is the one place to read (#169).
 */
function TrackerLibraryDialogs({
  creating,
  renaming,
  trashing,
  moving,
  shareTrackerId,
  sourceSpaceId,
  create,
  rename,
  trash,
  onCloseCreate,
  onCloseRename,
  onCloseTrash,
  onCloseMove,
  onCloseShare,
}: {
  creating: boolean;
  renaming?: TrackerSummary;
  trashing?: TrackerSummary;
  moving?: TrackerSummary;
  shareTrackerId?: string;
  sourceSpaceId?: string;
  create: UseMutationResult<TrackerSummary, Error, string>;
  rename: UseMutationResult<TrackerSummary, Error, { target: TrackerSummary; name: string }>;
  trash: UseMutationResult<unknown, Error, string>;
  onCloseCreate: () => void;
  onCloseRename: () => void;
  onCloseTrash: () => void;
  onCloseMove: () => void;
  onCloseShare: () => void;
}) {
  return (
    <>
      {creating && (
        <TrackerNameDialog
          dialogTitle="Start a tracker"
          description="Create a tracker and shape its fields and records next."
          submitLabel="Create tracker"
          busyLabel="Creating…"
          busy={create.isPending}
          error={create.error?.message}
          onCancel={() => {
            create.reset();
            onCloseCreate();
          }}
          onSubmit={(name) => create.mutate(name)}
        />
      )}
      {shareTrackerId && (
        <TrackerShareDialog
          trackerId={shareTrackerId}
          sourceSpaceId={sourceSpaceId}
          onClose={onCloseShare}
        />
      )}
      {moving && sourceSpaceId && (
        <MoveToSpaceDialog
          resourceType="tracker"
          resourceId={moving.id}
          resourceName={moving.name}
          sourceSpaceId={sourceSpaceId}
          onClose={onCloseMove}
        />
      )}
      {trashing && (
        <ConfirmationDialog
          title="Move tracker to trash?"
          description={
            <p>
              <strong>{trashing.name}</strong> stays recoverable for 30 days, then is permanently
              removed.
            </p>
          }
          confirmLabel="Move to trash"
          busyLabel="Moving…"
          busy={trash.isPending}
          error={trash.error?.message}
          onCancel={() => {
            trash.reset();
            onCloseTrash();
          }}
          onConfirm={() => trash.mutate(trashing.id)}
        />
      )}
      {renaming && (
        <TrackerNameDialog
          dialogTitle="Rename tracker"
          submitLabel="Rename"
          busyLabel="Renaming…"
          initialName={renaming.name}
          busy={rename.isPending}
          error={rename.error?.message}
          onCancel={() => {
            rename.reset();
            onCloseRename();
          }}
          onSubmit={(name) => rename.mutate({ target: renaming, name })}
        />
      )}
    </>
  );
}

/**
 * The library's body: its load, error, and empty states, or the shared library list.
 *
 * Trackers render through `LibraryList` like screenplays, breakdowns, and trash, so every library
 * reads as one idea rather than tables that drifted apart (#193).
 */
function TrackerLibraryBody({
  trackers,
  rows,
  rowMenu,
  trash,
  onOpen,
}: {
  trackers: ReturnType<typeof useQuery<TrackerSummary[], Error>>;
  rows: TrackerSummary[];
  rowMenu: (tracker: TrackerSummary) => ContextMenuItem[];
  trash: UseMutationResult<unknown, Error, string>;
  onOpen: (id: string) => void;
}) {
  if (trackers.isLoading) return <LibraryEmpty title="Loading trackers…" />;
  if (trackers.error) {
    return (
      <LibraryEmpty
        alert
        title="Trackers could not be loaded."
        hint="Check the service connection, then try again."
        action={{ label: 'Try again', onClick: () => void trackers.refetch() }}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <LibraryEmpty
        title="No trackers yet"
        hint="Start tracking with the button above — fields and records come next."
      />
    );
  }
  const items: LibraryItem[] = rows.map((tracker) => ({
    id: tracker.id,
    name: tracker.name,
    meta: (
      <span>
        {trash.isPending && trash.variables === tracker.id
          ? 'Removing…'
          : `updated ${relativeTime(tracker.updatedAt)}`}
      </span>
    ),
    menu: rowMenu(tracker),
  }));
  return <LibraryList items={items} ariaLabel="Trackers" onActivate={onOpen} />;
}

function surfaceMenuItems(onCreate: () => void): ContextMenuItem[] {
  return [{ id: 'new-tracker', label: 'New tracker…', onSelect: onCreate }];
}

function buildRowMenu(
  tracker: TrackerSummary,
  handlers: {
    onOpen: (id: string) => void;
    onRename: (tracker: TrackerSummary) => void;
    onManage: (tracker: TrackerSummary) => void;
    onMoveToTrash: (tracker: TrackerSummary) => void;
    onMoveToSpace: (tracker: TrackerSummary) => void;
    trashing: boolean;
  },
): ContextMenuItem[] {
  return [
    {
      id: 'open',
      label: 'Open',
      icon: ArrowSquareOutIcon,
      onSelect: () => handlers.onOpen(tracker.id),
    },
    moveToSpaceMenuItem('tracker', () => handlers.onMoveToSpace(tracker)),
    {
      id: 'rename',
      label: 'Rename…',
      icon: PencilSimpleIcon,
      onSelect: () => handlers.onRename(tracker),
    },
    {
      // One word for this operation across every resource and surface that offers it: the library
      // row menu, `File ▸ Share…`, and the management URL (#176, #381).
      id: 'manage',
      label: 'Share…',
      icon: UsersThreeIcon,
      onSelect: () => handlers.onManage(tracker),
    },
    {
      id: 'trash',
      label: 'Move to trash',
      icon: TrashIcon,
      danger: true,
      disabled: handlers.trashing,
      onSelect: () => handlers.onMoveToTrash(tracker),
    },
  ];
}

/**
 * Publishes this surface to the application menu bar, so `File ▸ New Tracker`, `Rename`,
 * `Move to Trash`, `Find`, and `Refresh` run the list's own handlers instead of the shell
 * reimplementing them (see `app-shell/library-target`).
 */
function useTrackerLibrary(surface: {
  trackers: TrackerSummary[] | undefined;
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (tracker: TrackerSummary) => void;
  refetch: () => void;
  trashTracker: (id: string) => void;
}) {
  const { trackers, loading, onOpen, onCreate, onRename } = surface;
  const { refetch, trashTracker } = surface;
  const target = useMemo<LibraryTarget>(
    () => ({
      noun: 'trackers',
      singular: 'tracker',
      loading,
      objects: (trackers ?? []).map((tracker) => ({ id: tracker.id, title: tracker.name })),
      createItem: onCreate,
      refresh: refetch,
      openObject: onOpen,
      renameObject: (id) => {
        const tracker = trackers?.find((candidate) => candidate.id === id);
        if (tracker) onRename(tracker);
      },
      trashObject: trashTracker,
    }),
    [trackers, loading, onOpen, onCreate, onRename, refetch, trashTracker],
  );
  usePublishLibraryTarget(target);
}

export interface TrackersScreenProps {
  onOpen: (id: string) => void;
  /** When set, the tracker whose share modal this route presents. */
  shareTrackerId?: string;
  /** Navigates to a tracker's share URL, so the modal is addressable and back/forward work. */
  onShare?: (id: string) => void;
  onCloseShare?: () => void;
  activeSpaceId?: string;
}

/**
 * The tracker library. Object management happens here rather than on a route of its own (#176):
 * persistent detail in the properties, creation, rename, sharing as a route-addressable modal
 * (#381), and moving to trash behind a confirmation. The workspace lands at `/trackers/:id`.
 */
export function TrackersScreen({
  onOpen,
  shareTrackerId,
  onShare,
  onCloseShare,
  activeSpaceId,
}: TrackersScreenProps) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<TrackerSummary>();
  const [trashing, setTrashing] = useState<TrackerSummary>();
  const [moving, setMoving] = useState<TrackerSummary>();
  const queryClient = useQueryClient();
  const trackers = useQuery({
    queryKey: ['trackers', activeSpaceId],
    queryFn: () => listTrackers(activeSpaceId),
  });
  const create = useMutation({
    mutationFn: (name: string) => createTracker({ name }),
    onSuccess: (tracker) => {
      void queryClient.invalidateQueries({ queryKey: ['trackers'] });
      onOpen(tracker.id);
    },
  });
  const rename = useMutation({
    mutationFn: ({ target, name }: { target: TrackerSummary; name: string }) =>
      renameTracker({ trackerId: target.id, name, version: target.version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trackers'] });
      setRenaming(undefined);
    },
  });
  const trash = useMutation({
    mutationFn: (id: string) => trashTracker(id),
    onSuccess: () => {
      setTrashing(undefined);
      void queryClient.invalidateQueries({ queryKey: ['trackers'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-trackers'] });
    },
  });
  const startCreate = useCallback(() => setCreating(true), []);
  const startRename = useCallback((tracker: TrackerSummary) => setRenaming(tracker), []);
  const startTrash = useCallback((tracker: TrackerSummary) => setTrashing(tracker), []);
  // The menu bar and ⌘K palette address objects by id; the confirmation needs the row.
  const trashById = useCallback(
    (id: string) => {
      const tracker = trackers.data?.find((candidate) => candidate.id === id);
      if (tracker) setTrashing(tracker);
    },
    [trackers.data],
  );
  useTrackerLibrary({
    trackers: trackers.data,
    loading: trackers.isLoading,
    onOpen,
    onCreate: startCreate,
    onRename: startRename,
    refetch: trackers.refetch,
    trashTracker: trashById,
  });

  // One builder feeds the row context menu, mirroring the sibling libraries.
  const rowMenu = (tracker: TrackerSummary): ContextMenuItem[] =>
    buildRowMenu(tracker, {
      onOpen,
      onRename: startRename,
      onManage: (target) => onShare?.(target.id),
      onMoveToTrash: startTrash,
      onMoveToSpace: setMoving,
      trashing: trash.isPending && trash.variables === tracker.id,
    });

  return (
    <SurfaceContextMenu
      items={surfaceMenuItems(() => setCreating(true))}
      ariaLabel="Trackers actions"
    >
      <LibraryPage
        title="Trackers"
        subtitle="Every tracker you own, and every one shared with you."
        actions={
          <HeaderButton primary onClick={startCreate}>
            <PlusIcon size={12} weight="bold" aria-hidden="true" /> New tracker
          </HeaderButton>
        }
      >
        <TrackerLibraryBody
          trackers={trackers}
          rows={trackers.data ?? []}
          rowMenu={rowMenu}
          trash={trash}
          onOpen={onOpen}
        />
        <TrackerLibraryDialogs
          creating={creating}
          renaming={renaming}
          trashing={trashing}
          moving={moving}
          shareTrackerId={shareTrackerId}
          sourceSpaceId={activeSpaceId}
          create={create}
          rename={rename}
          trash={trash}
          onCloseCreate={() => setCreating(false)}
          onCloseRename={() => setRenaming(undefined)}
          onCloseTrash={() => setTrashing(undefined)}
          onCloseMove={() => setMoving(undefined)}
          onCloseShare={() => onCloseShare?.()}
        />
      </LibraryPage>
    </SurfaceContextMenu>
  );
}
