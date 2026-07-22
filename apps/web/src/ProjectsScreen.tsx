import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { groupProjects } from './project-list';
import {
  ProjectsHeader,
  ProjectsOverview,
  ProjectsSidebar,
  ProjectsTrash,
} from './projects/ProjectsViews';
import type { Project, ProjectsPage, SessionUser, TrashedProject } from './projects/types';
import styles from './ProjectsScreen.module.css';

export { groupProjects } from './project-list';
export type { Project } from './projects/types';

export function ProjectsScreen({
  onOpen,
  onManage,
  onCreate,
  page,
  embedded = false,
  onPageChange,
}: {
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
  onCreate: () => void;
  page?: ProjectsPage;
  embedded?: boolean;
  onPageChange?: (page: ProjectsPage) => void;
}) {
  const [localPage, setLocalPage] = useState<ProjectsPage>('overview');
  const activePage = page ?? localPage;
  const [projectToPurge, setProjectToPurge] = useState<TrashedProject | null>(null);
  const queryClient = useQueryClient();
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
  const setActivePage = (nextPage: ProjectsPage) => {
    setLocalPage(nextPage);
    onPageChange?.(nextPage);
  };
  const retryProjects = () => {
    void projects.refetch();
    void session.refetch();
  };

  return (
    <main
      className={`${styles.projectsPage} ${embedded ? styles.embedded : ''}`}
      aria-busy={loadingProjects || (activePage === 'deleted' && trashedProjects.isLoading)}
    >
      <div className={styles.projectsShell}>
        {!embedded && <ProjectsSidebar activePage={activePage} onPageChange={setActivePage} />}
        <div className={styles.content}>
          <ProjectsHeader activePage={activePage} onCreate={onCreate} />
          {activePage === 'overview' ? (
            <ProjectsOverview
              loading={loadingProjects}
              failed={Boolean(projects.error || session.error)}
              owned={groups.owned}
              shared={groups.shared}
              onRetry={retryProjects}
              onOpen={onOpen}
              onManage={onManage}
            />
          ) : (
            <ProjectsTrash
              loading={trashedProjects.isLoading}
              failed={Boolean(trashedProjects.error)}
              projects={trashedProjects.data ?? []}
              restoringProjectId={restore.isPending ? restore.variables : undefined}
              mutationPending={restore.isPending || purge.isPending}
              restoreFailed={Boolean(restore.error)}
              onRetry={() => void trashedProjects.refetch()}
              onRestore={(projectId) => restore.mutate(projectId)}
              onPurge={setProjectToPurge}
            />
          )}
        </div>
      </div>
      {projectToPurge && (
        <ConfirmationDialog
          title="Delete project permanently?"
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
    </main>
  );
}
