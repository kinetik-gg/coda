import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import {
  CellIcon,
  Chip,
  DataTable,
  InlineEmpty,
  InlineError,
  PrimaryText,
  RowStatus,
  ScrollBody,
  SectionLabel,
  StateBlock,
  TimeCell,
  type ContextMenuItem,
  type DataColumn,
} from '../content-lists';
import { BreakdownInspectorSplit, type BreakdownSelectionProps } from './inspector';
import type { Project, TrashEntry, TrashKind } from './types';

const BREAKDOWN_GRID =
  'var(--coda-space-6) minmax(0, 1fr) max-content max-content var(--coda-h-menu)';
const TRASH_GRID =
  'var(--coda-space-6) minmax(0, 1fr) max-content max-content max-content var(--coda-h-menu)';

function canManageProject(project: Project): boolean {
  return Boolean(
    project.currentMembership?.role.permissions.some(
      (entry) => entry.permission === 'manage_project_settings',
    ),
  );
}

const breakdownColumns: DataColumn<Project>[] = [
  { key: 'icon', header: '', render: () => <CellIcon icon={FolderOpenIcon} /> },
  {
    key: 'name',
    header: 'Name',
    render: (project) => (
      <PrimaryText name={project.name} subtitle={project.description ?? undefined} />
    ),
  },
  {
    key: 'role',
    header: 'Role',
    render: (project) =>
      project.currentMembership ? <Chip>{project.currentMembership.role.name}</Chip> : null,
  },
  {
    key: 'updated',
    header: 'Updated',
    numeric: true,
    render: (project) => <TimeCell iso={project.updatedAt} />,
  },
];

/**
 * Breakdown row actions wired to what the domain exposes today. Details and Share are permission
 * gated on `manage_project_settings`, the same permission the settings surface itself requires.
 * One builder feeds both the row context menu and the inspector's quick actions (#169), so the two
 * surfaces cannot answer the same question differently.
 */
export function buildProjectMenu(
  project: Project,
  handlers: {
    onOpen: (id: string) => void;
    onManage: (id: string) => void;
    onDetails?: (id: string) => void;
    onShare?: (id: string) => void;
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
      label: 'Manage…',
      icon: GearSixIcon,
      onSelect: () => handlers.onManage(project.id),
    });
  }
  return items;
}

function BreakdownSection({
  label,
  projects,
  emptyMessage,
  buildMenu,
  selection,
  onOpen,
}: {
  label: string;
  projects: Project[];
  emptyMessage: string;
  buildMenu: (project: Project) => ContextMenuItem[];
  selection: BreakdownSelectionProps;
  onOpen: (id: string) => void;
}) {
  return (
    <section aria-label={label}>
      <SectionLabel label={label} count={projects.length} />
      {projects.length ? (
        <DataTable
          ariaLabel={label}
          columns={breakdownColumns}
          gridTemplate={BREAKDOWN_GRID}
          rows={projects}
          rowKey={(project) => project.id}
          rowLabel={(project) => project.name}
          onActivate={(project) => onOpen(project.id)}
          buildMenu={buildMenu}
          {...selection}
        />
      ) : (
        <InlineEmpty message={emptyMessage} />
      )}
    </section>
  );
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
  onCreate,
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
  onCreate: () => void;
}) {
  if (loading) return <StateBlock message="Loading breakdowns…" />;
  if (failed) {
    return (
      <StateBlock
        alert
        message="Breakdowns could not be loaded. Check the service connection, then try again."
        action={{ label: 'Try again', onClick: onRetry }}
      />
    );
  }
  if (!owned.length && !shared.length) {
    const filtered = Boolean(query?.trim());
    return (
      <StateBlock
        message={
          filtered
            ? `No breakdowns match “${query}”.`
            : 'Create a breakdown to begin analyzing a source document.'
        }
        action={
          filtered ? undefined : { label: 'Create a breakdown', onClick: onCreate, primary: true }
        }
      />
    );
  }
  // One builder feeds both tables' row menus and the inspector's quick actions.
  const buildMenu = (project: Project): ContextMenuItem[] =>
    buildProjectMenu(project, { onOpen, onManage, onDetails, onShare });
  return (
    <BreakdownInspectorSplit rows={[...owned, ...shared]} buildMenu={buildMenu}>
      {(selection) => (
        <ScrollBody>
          <BreakdownSection
            label="My breakdowns"
            projects={owned}
            emptyMessage="No breakdowns of your own yet."
            buildMenu={buildMenu}
            selection={selection}
            onOpen={onOpen}
          />
          <BreakdownSection
            label="Shared with me"
            projects={shared}
            emptyMessage="Nothing shared with you."
            buildMenu={buildMenu}
            selection={selection}
            onOpen={onOpen}
          />
        </ScrollBody>
      )}
    </BreakdownInspectorSplit>
  );
}

const KIND_LABEL: Record<TrashKind, string> = {
  breakdown: 'Breakdown',
  screenplay: 'Screenplay',
};

const trashColumns: DataColumn<TrashEntry>[] = [
  {
    key: 'icon',
    header: '',
    render: (entry) => (
      <CellIcon icon={entry.kind === 'screenplay' ? BookOpenTextIcon : FolderOpenIcon} />
    ),
  },
  {
    key: 'name',
    header: 'Name',
    render: (entry) => <PrimaryText name={entry.name} />,
  },
  { key: 'kind', header: 'Kind', render: (entry) => <Chip>{KIND_LABEL[entry.kind]}</Chip> },
  {
    key: 'deleted',
    header: 'Deleted',
    numeric: true,
    render: (entry) => <TimeCell iso={entry.deletedAt} />,
  },
  {
    key: 'expires',
    header: 'Expires',
    numeric: true,
    render: (entry) => <TimeCell iso={entry.purgeAfter} />,
  },
];

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
  restoringId,
  restoreFailed,
  onRetry,
  onRestore,
  onPurge,
}: {
  loading: boolean;
  failed: boolean;
  entries: TrashEntry[];
  query?: string;
  restoringId?: string;
  restoreFailed: boolean;
  onRetry: () => void;
  onRestore: (entry: TrashEntry) => void;
  onPurge: (entry: TrashEntry) => void;
}) {
  if (loading) return <StateBlock message="Loading trash…" />;
  if (failed) {
    return (
      <StateBlock
        alert
        message="Trash could not be loaded. Check the service connection, then try again."
        action={{ label: 'Try again', onClick: onRetry }}
      />
    );
  }
  if (!entries.length) {
    return (
      <StateBlock
        message={
          query?.trim()
            ? `No trashed items match “${query}”.`
            : 'Trash is empty. Deleted breakdowns and screenplays stay recoverable here for 30 days.'
        }
      />
    );
  }
  return (
    <ScrollBody>
      <DataTable
        ariaLabel="Recoverable items"
        columns={trashColumns}
        gridTemplate={TRASH_GRID}
        rows={entries}
        rowKey={(entry) => `${entry.kind}:${entry.id}`}
        rowLabel={(entry) => entry.name}
        buildMenu={(entry) => buildTrashMenu(entry, onRestore, onPurge)}
        trailingCell={(entry) =>
          restoringId === entry.id ? (
            <RowStatus>Restoring…</RowStatus>
          ) : !entry.canRestore ? (
            <RowStatus>Owner only</RowStatus>
          ) : null
        }
      />
      {restoreFailed && <InlineError message="The item could not be restored. Please try again." />}
    </ScrollBody>
  );
}
