import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { api } from './api';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { ContentListPage, HeaderButton, PanelHeader } from './content-lists';
import { groupProjects } from './project-list';
import { BreakdownDetailsDialog } from './projects/BreakdownDetailsDialog';
import { ProjectsOverview, ProjectsTrash } from './projects/ProjectsViews';
import type {
  Project,
  ProjectsPage,
  SessionUser,
  TrashEntry,
  TrashedProject,
  TrashedScreenplay,
} from './projects/types';
import { messages } from './messages';

export { groupProjects } from './project-list';
export type { Project } from './projects/types';

function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

function toTrashEntries(
  projects: TrashedProject[],
  screenplays: TrashedScreenplay[],
  query: string,
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
  return [...breakdownEntries, ...screenplayEntries]
    .filter((entry) => matches(entry.name, query))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
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

  const restoreEntry = (entry: TrashEntry) =>
    entry.kind === 'breakdown' ? restore.mutate(entry.id) : restoreScreenplay.mutate(entry.id);
  const confirmPurge = () => {
    if (!entryToPurge) return;
    if (entryToPurge.kind === 'breakdown') purge.mutate(entryToPurge.id);
    else purgeScreenplay.mutate(entryToPurge.id);
  };
  const cancelPurge = () => {
    setEntryToPurge(null);
    purge.reset();
    purgeScreenplay.reset();
  };
  const restoringId = restore.isPending
    ? restore.variables
    : restoreScreenplay.isPending
      ? restoreScreenplay.variables
      : undefined;

  return {
    entryToPurge,
    requestPurge: setEntryToPurge,
    restoreEntry,
    confirmPurge,
    cancelPurge,
    restoringId,
    restoreFailed: Boolean(restore.error || restoreScreenplay.error),
    purging: purge.isPending || purgeScreenplay.isPending,
    purgeError: (purge.error ?? purgeScreenplay.error)?.message,
  };
}

export function ProjectsScreen({
  onOpen,
  onManage,
  onShare,
  onCreate,
  page = 'overview',
}: {
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
  /** Navigates to a breakdown's share URL, so the modal stays addressable. */
  onShare?: (id: string) => void;
  onCreate: () => void;
  page?: ProjectsPage;
  embedded?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [detailsFor, setDetailsFor] = useState<string>();
  const queryClient = useQueryClient();
  const isTrash = page === 'deleted';
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionUser>('/api/v1/auth/session'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/api/v1/projects'),
  });
  const trashedProjects = useQuery({
    queryKey: ['trashed-projects'],
    queryFn: () => api<TrashedProject[]>('/api/v1/projects/trash'),
  });
  const trashedScreenplays = useQuery({
    queryKey: ['trashed-screenplays'],
    queryFn: () => api<TrashedScreenplay[]>('/api/v1/screenplays/trash'),
  });
  const trash = useTrashLifecycle(queryClient);

  const groups = groupProjects(projects.data ?? [], session.data?.id);
  const loadingProjects = projects.isLoading || session.isLoading;
  const trashLoading = trashedProjects.isLoading || trashedScreenplays.isLoading;
  const owned = useMemo(
    () => groups.owned.filter((project) => matches(project.name, query)),
    [groups.owned, query],
  );
  const shared = useMemo(
    () => groups.shared.filter((project) => matches(project.name, query)),
    [groups.shared, query],
  );
  const trashEntries = useMemo(
    () => toTrashEntries(trashedProjects.data ?? [], trashedScreenplays.data ?? [], query),
    [trashedProjects.data, trashedScreenplays.data, query],
  );

  const retryProjects = () => {
    void projects.refetch();
    void session.refetch();
  };
  const retryTrash = () => {
    void trashedProjects.refetch();
    void trashedScreenplays.refetch();
  };

  const trashCount = (trashedProjects.data?.length ?? 0) + (trashedScreenplays.data?.length ?? 0);
  const count = isTrash ? trashCount : groups.owned.length + groups.shared.length;

  return (
    <ContentListPage busy={loadingProjects || (isTrash && trashLoading)}>
      <PanelHeader
        title={isTrash ? 'Trash' : messages.projects}
        count={count}
        search={{
          value: query,
          onChange: setQuery,
          label: isTrash ? 'Search trash' : 'Search breakdowns',
        }}
        actions={
          isTrash ? undefined : (
            <HeaderButton primary onClick={onCreate}>
              <PlusIcon size={12} weight="bold" aria-hidden="true" /> {messages.newProject}
            </HeaderButton>
          )
        }
      />
      {isTrash ? (
        <ProjectsTrash
          loading={trashLoading}
          failed={Boolean(trashedProjects.error || trashedScreenplays.error)}
          entries={trashEntries}
          query={query}
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
          query={query}
          onRetry={retryProjects}
          onOpen={onOpen}
          onManage={onManage}
          onDetails={setDetailsFor}
          onShare={onShare}
          onCreate={onCreate}
        />
      )}
      {detailsFor && (
        <BreakdownDetailsDialog projectId={detailsFor} onClose={() => setDetailsFor(undefined)} />
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
    </ContentListPage>
  );
}
