import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import {
  InlineError,
  LibraryEmpty,
  LibraryList,
  type ContextMenuItem,
  type LibraryItem,
} from '../content-lists';
import { relativeTime } from '../content-lists/relative-time';
import { canManageProject, canTrashProject } from './access';
import type { Project, TrashEntry, TrashKind } from './types';

/**
 * Breakdown row actions wired to what the domain exposes today. Share is the fast path into the
 * unified management modal's Share section; Manage breakdown opens the same modal on its default
 * Details section. One builder feeds both the row context menu and properties quick actions.
 */
export function buildProjectMenu(
  project: Project,
  handlers: {
    onOpen: (id: string) => void;
    onManage: (id: string) => void;
    onDetails?: (id: string) => void;
    onShare?: (id: string) => void;
    onMoveToTrash?: (project: Project) => void;
    sessionUserId?: string;
  },
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      id: 'open',
      label: 'Open',
      icon: ArrowSquareOutIcon,
      onSelect: () => handlers.onOpen(project.id),
    },
  ];
  if (canManageProject(project)) {
    if (handlers.onDetails) {
      items.push({
        id: 'details',
        label: 'Details…',
        icon: PencilSimpleIcon,
        onSelect: () => handlers.onDetails?.(project.id),
      });
    }
    if (handlers.onShare) {
      items.push({
        id: 'share',
        label: 'Share…',
        icon: UsersThreeIcon,
        onSelect: () => handlers.onShare?.(project.id),
      });
    }
    items.push({
      id: 'manage',
      label: 'Manage breakdown…',
      icon: GearSixIcon,
      onSelect: () => handlers.onManage(project.id),
    });
  }
  if (handlers.onMoveToTrash && canTrashProject(project, handlers.sessionUserId)) {
    items.push({
      id: 'trash',
      label: 'Move to trash',
      icon: TrashIcon,
      danger: true,
      onSelect: () => handlers.onMoveToTrash?.(project),
    });
  }
  return items;
}

export function ProjectsOverview({
  loading,
  failed,
  owned,
  shared,
  query,
  onRetry,
  onOpen,
  onManage,
  onDetails,
  onShare,
  onMoveToTrash,
  sessionUserId,
}: {
  loading: boolean;
  failed: boolean;
  owned: Project[];
  shared: Project[];
  query?: string;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
  onDetails?: (id: string) => void;
  onShare?: (id: string) => void;
  onMoveToTrash?: (project: Project) => void;
  /** Deletion is owner-only, so the row menu needs to know who is looking. */
  sessionUserId?: string;
}) {
  if (loading) return <LibraryEmpty title="Loading breakdowns…" />;
  if (failed) {
    return (
      <LibraryEmpty
        alert
        title="Breakdowns could not be loaded."
        hint="Check the service connection, then try again."
        action={{ label: 'Try again', onClick: onRetry }}
      />
    );
  }
  if (!owned.length && !shared.length) {
    const filtered = Boolean(query?.trim());
    return filtered ? (
      <LibraryEmpty title={`No breakdowns match “${query}”`} />
    ) : (
      <LibraryEmpty
        title="No breakdowns yet"
        hint="Start creating your breakdown using the button above"
      />
    );
  }
  const buildMenu = (project: Project): ContextMenuItem[] =>
    buildProjectMenu(project, {
      onOpen,
      onManage,
      onDetails,
      onShare,
      onMoveToTrash,
      sessionUserId,
    });
  // One list, with sharing carried as a row tag. Two sections for what is often two rows read as
  // ceremony; the tag says the same thing where the eye already is (#193).
  const items: LibraryItem[] = [...owned, ...shared].map((project) => ({
    id: project.id,
    name: project.name,
    tag: shared.some((candidate) => candidate.id === project.id) ? 'Shared with you' : undefined,
    meta: <span>{`updated ${relativeTime(project.updatedAt)}`}</span>,
    menu: buildMenu(project),
  }));
  return <LibraryList items={items} ariaLabel="Breakdowns" onActivate={onOpen} />;
}

const KIND_LABEL: Record<TrashKind, string> = {
  breakdown: 'Breakdown',
  screenplay: 'Screenplay',
};

function buildTrashMenu(
  entry: TrashEntry,
  onRestore: (entry: TrashEntry) => void,
  onPurge: (entry: TrashEntry) => void,
): ContextMenuItem[] {
  if (!entry.canRestore) return [];
  return [
    {
      id: 'restore',
      label: 'Restore',
      icon: ArrowCounterClockwiseIcon,
      onSelect: () => onRestore(entry),
    },
    {
      id: 'purge',
      label: 'Delete permanently…',
      icon: TrashIcon,
      danger: true,
      onSelect: () => onPurge(entry),
    },
  ];
}

export function ProjectsTrash({
  loading,
  failed,
  entries,
  query,
  onRetry,
  restoringId,
  restoreFailed,
  onRestore,
  onPurge,
}: {
  loading: boolean;
  failed: boolean;
  entries: TrashEntry[];
  query?: string;
  onRetry: () => void;
  restoringId?: string;
  restoreFailed: boolean;
  onRestore: (entry: TrashEntry) => void;
  onPurge: (entry: TrashEntry) => void;
}) {
  if (loading) return <LibraryEmpty title="Loading trash…" />;
  if (failed) {
    return (
      <LibraryEmpty
        alert
        title="Trash could not be loaded."
        hint="Check the service connection, then try again."
        action={{ label: 'Try again', onClick: onRetry }}
      />
    );
  }
  if (!entries.length) {
    return query?.trim() ? (
      <LibraryEmpty title={`No trashed items match “${query}”`} />
    ) : (
      <LibraryEmpty
        title="Trash is empty"
        hint="Deleted breakdowns and screenplays stay recoverable here for 30 days."
      />
    );
  }
  const items: LibraryItem[] = entries.map((entry) => ({
    id: `${entry.kind}:${entry.id}`,
    name: entry.name,
    tag: KIND_LABEL[entry.kind],
    meta: (
      <span>
        {restoringId === entry.id
          ? 'Restoring…'
          : !entry.canRestore
            ? 'Owner only'
            : `will be permanently deleted ${relativeTime(entry.purgeAfter)}`}
      </span>
    ),
    menu: buildTrashMenu(entry, onRestore, onPurge),
  }));
  return (
    <>
      <LibraryList items={items} ariaLabel="Recoverable items" />
      {restoreFailed && <InlineError message="The item could not be restored. Please try again." />}
    </>
  );
}
