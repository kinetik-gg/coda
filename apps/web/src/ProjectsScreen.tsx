import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { api } from './api';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { ContentListPage, HeaderButton, PanelHeader } from './content-lists';
import { groupProjects } from './project-list';
import { ProjectsOverview, ProjectsTrash } from './projects/ProjectsViews';
import type { Project, ProjectsPage, SessionUser, TrashedProject } from './projects/types';
import { messages } from './messages';

export { groupProjects } from './project-list';
export type { Project } from './projects/types';

function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

export function ProjectsScreen({
  onOpen,
  onManage,
  onCreate,
  page = 'overview',
}: {
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
  onCreate: () => void;
  page?: ProjectsPage;
  embedded?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [projectToPurge, setProjectToPurge] = useState<TrashedProject | null>(null);
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
  const restore = useMutation({
    mutationFn: (projectId: string) =>
      api(`/api/v1/projects/${projectId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-projects'] });
    },
  });
  const purge = useMutation({
    mutationFn: (projectId: string) =>
      api(`/api/v1/projects/${projectId}/purge`, { method: 'DELETE' }),
    onSuccess: () => {
      setProjectToPurge(null);
      void queryClient.invalidateQueries({ queryKey: ['trashed-projects'] });
      void queryClient.invalidateQueries({ queryKey: ['instance-management'] });
    },
  });

  const groups = groupProjects(projects.data ?? [], session.data?.id);
  const loadingProjects = projects.isLoading || session.isLoading;
  const owned = useMemo(
    () => groups.owned.filter((project) => matches(project.name, query)),
    [groups.owned, query],
  );
  const shared = useMemo(
    () => groups.shared.filter((project) => matches(project.name, query)),
    [groups.shared, query],
  );
  const trashed = useMemo(
    () => (trashedProjects.data ?? []).filter((project) => matches(project.name, query)),
    [trashedProjects.data, query],
  );

  const retryProjects = () => {
    void projects.refetch();
    void session.refetch();
  };

  const count = isTrash
    ? (trashedProjects.data?.length ?? 0)
    : groups.owned.length + groups.shared.length;

  return (
    <ContentListPage busy={loadingProjects || (isTrash && trashedProjects.isLoading)}>
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
          loading={trashedProjects.isLoading}
          failed={Boolean(trashedProjects.error)}
          projects={trashed}
          query={query}
          restoringProjectId={restore.isPending ? restore.variables : undefined}
          restoreFailed={Boolean(restore.error)}
          onRetry={() => void trashedProjects.refetch()}
          onRestore={(projectId) => restore.mutate(projectId)}
          onPurge={setProjectToPurge}
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
          onCreate={onCreate}
        />
      )}
      {projectToPurge && (
        <ConfirmationDialog
          title="Delete breakdown permanently?"
          description={
            <p>
              <strong>{projectToPurge.name}</strong> and all of its retained data will be removed
              immediately. This cannot be undone.
            </p>
          }
          confirmLabel="Delete permanently"
          busyLabel="Deleting…"
          busy={purge.isPending}
          error={purge.error?.message}
          onCancel={() => {
            setProjectToPurge(null);
            purge.reset();
          }}
          onConfirm={() => purge.mutate(projectToPurge.id)}
        />
      )}
    </ContentListPage>
  );
}
