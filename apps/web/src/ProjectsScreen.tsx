import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { api, listTrashedTrackers, purgeTracker, restoreTracker } from './api';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import {
  HeaderButton,
  LibraryPage,
  SurfaceContextMenu,
  type ContextMenuItem,
} from './content-lists';
import { ProjectManagementModal } from './project-management/ProjectManagementModal';
import type { SectionId } from './project-management/types';
import { groupProjects } from './project-list';
import { BreakdownDetailsDialog } from './projects/BreakdownDetailsDialog';
import { MoveToSpaceDialog } from './spaces/MoveToSpaceDialog';
import { ProjectsOverview, ProjectsTrash } from './projects/ProjectsViews';
import type {
  Project,
  ProjectsPage,
  SessionUser,
  TrashEntry,
  TrashedProject,
  TrashedScreenplay,
} from './projects/types';
import type { TrashedTracker } from './trackers/types';
import { messages } from './messages';

export { groupProjects } from './project-list';
export type { Project } from './projects/types';

function toTrashEntries(
  projects: TrashedProject[],
  screenplays: TrashedScreenplay[],
  trackers: TrashedTracker[],
): TrashEntry[] {
  const breakdownEntries: TrashEntry[] = projects.map((project) => ({
    id: project.id,
    kind: 'breakdown',
    name: project.name,
    deletedAt: project.deletedAt,
    purgeAfter: project.purgeAfter,
    canRestore: project.canRestore,
  }));
  const screenplayEntries: TrashEntry[] = screenplays.map((screenplay) => ({
    id: screenplay.id,
    kind: 'screenplay',
    name: screenplay.title,
    deletedAt: screenplay.deletedAt,
    purgeAfter: screenplay.purgeAfter,
    canRestore: screenplay.canRestore,
  }));
  const trackerEntries: TrashEntry[] = trackers.map((tracker) => ({
    id: tracker.id,
    kind: 'tracker',
    name: tracker.name,
    deletedAt: tracker.deletedAt,
    purgeAfter: tracker.purgeAfter,
    canRestore: tracker.canRestore,
  }));
  return [...breakdownEntries, ...screenplayEntries, ...trackerEntries].sort((a, b) =>
    b.deletedAt.localeCompare(a.deletedAt),
  );
}

/**
 * The restore/purge lifecycle for the unified Trash list. Breakdowns and
 * screenplays share the same verbs against their own endpoints; this hook keeps
 * the kind dispatch (and its branching) out of the screen component.
 */
function useTrashLifecycle(queryClient: QueryClient) {
  const [entryToPurge, setEntryToPurge] = useState<TrashEntry | null>(null);
  const restore = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-projects'] });
    },
  });
  const purge = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${id}/purge`, { method: 'DELETE' }),
    onSuccess: () => {
      setEntryToPurge(null);
      void queryClient.invalidateQueries({ queryKey: ['trashed-projects'] });
      void queryClient.invalidateQueries({ queryKey: ['instance-management'] });
    },
  });
  const restoreScreenplay = useMutation({
    mutationFn: (id: string) => api(`/api/v1/screenplays/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-screenplays'] });
    },
  });
  const purgeScreenplay = useMutation({
    mutationFn: (id: string) => api(`/api/v1/screenplays/${id}/purge`, { method: 'DELETE' }),
    onSuccess: () => {
      setEntryToPurge(null);
      void queryClient.invalidateQueries({ queryKey: ['trashed-screenplays'] });
    },
  });
  // Trackers run the same verbs against their own endpoints; a purge frees their retained
  // records and media, so the instance storage reading is invalidated like a breakdown's.
  const restoreTrackerEntry = useMutation({
    mutationFn: (id: string) => restoreTracker(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trackers'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-trackers'] });
    },
  });
  const purgeTrackerEntry = useMutation({
    mutationFn: (id: string) => purgeTracker(id),
    onSuccess: () => {
      setEntryToPurge(null);
      void queryClient.invalidateQueries({ queryKey: ['trashed-trackers'] });
      void queryClient.invalidateQueries({ queryKey: ['instance-management'] });
    },
  });

  const restoreEntry = (entry: TrashEntry) => {
    if (entry.kind === 'breakdown') restore.mutate(entry.id);
    else if (entry.kind === 'screenplay') restoreScreenplay.mutate(entry.id);
    else restoreTrackerEntry.mutate(entry.id);
  };
  const confirmPurge = () => {
    if (!entryToPurge) return;
    if (entryToPurge.kind === 'breakdown') purge.mutate(entryToPurge.id);
    else if (entryToPurge.kind === 'screenplay') purgeScreenplay.mutate(entryToPurge.id);
    else purgeTrackerEntry.mutate(entryToPurge.id);
  };
  const cancelPurge = () => {
    setEntryToPurge(null);
    purge.reset();
    purgeScreenplay.reset();
    purgeTrackerEntry.reset();
  };
  const restoringId = restore.isPending
    ? restore.variables
    : restoreScreenplay.isPending
      ? restoreScreenplay.variables
      : restoreTrackerEntry.isPending
        ? restoreTrackerEntry.variables
        : undefined;

  return {
    entryToPurge,
    requestPurge: setEntryToPurge,
    restoreEntry,
    confirmPurge,
    cancelPurge,
    restoringId,
    restoreFailed: Boolean(restore.error || restoreScreenplay.error || restoreTrackerEntry.error),
    purging: purge.isPending || purgeScreenplay.isPending || purgeTrackerEntry.isPending,
    purgeError: (purge.error ?? purgeScreenplay.error ?? purgeTrackerEntry.error)?.message,
  };
}

function ProjectManagementPresentation({
  projectId,
  section,
  onSectionChange,
  onClose,
  sourceSpaceId,
}: {
  projectId?: string;
  section?: SectionId;
  onSectionChange?: (section: SectionId) => void;
  onClose?: () => void;
  sourceSpaceId?: string;
}) {
  if (!projectId || !section) return null;
  return (
    <ProjectManagementModal
      projectId={projectId}
      section={section}
      onSectionChange={(nextSection) => onSectionChange?.(nextSection)}
      onClose={() => onClose?.()}
      onDeleted={() => onClose?.()}
      sourceSpaceId={sourceSpaceId}
    />
  );
}

/**
 * The breakdowns library. Object management happens here rather than on a route of its own (#176):
 * persistent detail in the properties, details in a focused dialog, and every management concern in
 * one route-addressable sectioned modal over the library.
 */
export function ProjectsScreen({
  onOpen,
  onManage,
  managementProjectId,
  managementSection,
  onShare,
  onManagementSectionChange,
  onCloseManagement,
  onCreate,
  page = 'overview',
  activeSpaceId,
}: {
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
  /** When set, the breakdown whose management modal this route presents. */
  managementProjectId?: string;
  managementSection?: SectionId;
  /** Navigates to the same modal's Share section. */
  onShare?: (id: string) => void;
  onManagementSectionChange?: (section: SectionId) => void;
  onCloseManagement?: () => void;
  onCreate: () => void;
  page?: ProjectsPage;
  embedded?: boolean;
  activeSpaceId?: string;
}) {
  const [detailsFor, setDetailsFor] = useState<string>();
  const [trashing, setTrashing] = useState<Project>();
  const [moving, setMoving] = useState<Project>();
  const queryClient = useQueryClient();
  const isTrash = page === 'deleted';
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionUser>('/api/v1/auth/session'),
  });
  const projects = useQuery({
    queryKey: ['projects', activeSpaceId],
    queryFn: () =>
      api<Project[]>(
        activeSpaceId ? `/api/v1/projects?spaceId=${activeSpaceId}` : '/api/v1/projects',
      ),
  });
  const trashedProjects = useQuery({
    queryKey: ['trashed-projects'],
    queryFn: () => api<TrashedProject[]>('/api/v1/projects/trash'),
  });
  const trashedScreenplays = useQuery({
    queryKey: ['trashed-screenplays'],
    queryFn: () => api<TrashedScreenplay[]>('/api/v1/screenplays/trash'),
  });
  const trashedTrackers = useQuery({
    queryKey: ['trashed-trackers'],
    queryFn: listTrashedTrackers,
  });
  const trash = useTrashLifecycle(queryClient);
  // Moving a breakdown to trash is destructive, so it is a confirmation raised from the row menu
  // and the properties rather than a section of a settings page (#176).
  const moveToTrash = useMutation({
    mutationFn: (id: string) => api(`/api/v1/projects/${id}/trash`, { method: 'DELETE' }),
    onSuccess: () => {
      setTrashing(undefined);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-projects'] });
    },
  });

  const groups = groupProjects(projects.data ?? [], session.data?.id);
  const loadingProjects = projects.isLoading || session.isLoading;
  const trashLoading =
    trashedProjects.isLoading || trashedScreenplays.isLoading || trashedTrackers.isLoading;
  const owned = groups.owned;
  const shared = groups.shared;
  const trashEntries = useMemo(
    () =>
      toTrashEntries(
        trashedProjects.data ?? [],
        trashedScreenplays.data ?? [],
        trashedTrackers.data ?? [],
      ),
    [trashedProjects.data, trashedScreenplays.data, trashedTrackers.data],
  );

  const retryProjects = () => {
    void projects.refetch();
    void session.refetch();
  };
  const retryTrash = () => {
    void trashedProjects.refetch();
    void trashedScreenplays.refetch();
    void trashedTrackers.refetch();
  };

  // Trash offers no creation; an empty-plane menu there would list something that cannot happen.
  const surfaceMenu: ContextMenuItem[] = isTrash
    ? []
    : [{ id: 'new-breakdown', label: 'New breakdown…', onSelect: onCreate }];

  return (
    <SurfaceContextMenu items={surfaceMenu} ariaLabel="Breakdowns actions">
      <LibraryPage
        title={isTrash ? 'Trash' : 'Breakdowns'}
        subtitle={
          isTrash
            ? 'Deleted breakdowns, screenplays, and trackers stay recoverable for 30 days.'
            : 'Every breakdown you own, and every one shared with you.'
        }
        actions={
          isTrash ? undefined : (
            <HeaderButton primary onClick={onCreate}>
              <PlusIcon size={12} weight="bold" aria-hidden="true" /> {messages.newProject}
            </HeaderButton>
          )
        }
      >
        {isTrash ? (
          <ProjectsTrash
            loading={trashLoading}
            failed={Boolean(
              trashedProjects.error || trashedScreenplays.error || trashedTrackers.error,
            )}
            entries={trashEntries}
            restoringId={trash.restoringId}
            restoreFailed={trash.restoreFailed}
            onRetry={retryTrash}
            onRestore={trash.restoreEntry}
            onPurge={trash.requestPurge}
          />
        ) : (
          <ProjectsOverview
            loading={loadingProjects}
            failed={Boolean(projects.error || session.error)}
            owned={owned}
            shared={shared}
            onRetry={retryProjects}
            onOpen={onOpen}
            onManage={onManage}
            onDetails={setDetailsFor}
            onShare={onShare}
            onMoveToTrash={setTrashing}
            onMoveToSpace={setMoving}
            sessionUserId={session.data?.id}
          />
        )}
        {detailsFor && (
          <BreakdownDetailsDialog projectId={detailsFor} onClose={() => setDetailsFor(undefined)} />
        )}
        <ProjectManagementPresentation
          projectId={managementProjectId}
          section={managementSection}
          onSectionChange={onManagementSectionChange}
          onClose={onCloseManagement}
          sourceSpaceId={activeSpaceId}
        />
        {trashing && (
          <ConfirmationDialog
            title="Move breakdown to trash?"
            description={
              <p>
                <strong>{trashing.name}</strong> and everything it holds stays recoverable for 30
                days, then is permanently removed.
              </p>
            }
            confirmLabel="Move to trash"
            busyLabel="Moving…"
            busy={moveToTrash.isPending}
            error={moveToTrash.error?.message}
            onCancel={() => {
              moveToTrash.reset();
              setTrashing(undefined);
            }}
            onConfirm={() => moveToTrash.mutate(trashing.id)}
          />
        )}
        {moving && activeSpaceId && (
          <MoveToSpaceDialog
            resourceType="breakdown"
            resourceId={moving.id}
            resourceName={moving.name}
            sourceSpaceId={activeSpaceId}
            onClose={() => setMoving(undefined)}
          />
        )}
        {trash.entryToPurge && (
          <ConfirmationDialog
            title={`Delete ${trash.entryToPurge.kind} permanently?`}
            description={
              <p>
                <strong>{trash.entryToPurge.name}</strong> and all of its retained data will be
                removed immediately. This cannot be undone.
              </p>
            }
            confirmLabel="Delete permanently"
            busyLabel="Deleting…"
            busy={trash.purging}
            error={trash.purgeError}
            onCancel={trash.cancelPurge}
            onConfirm={trash.confirmPurge}
          />
        )}
      </LibraryPage>
    </SurfaceContextMenu>
  );
}
