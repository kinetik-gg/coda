import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { api } from './api';
import { HeaderButton, PanelHeader } from './content-lists';
import styles from './ProjectManagementScreen.styles';
import {
  DataOperationsSection,
  useDataOperationsController,
} from './project-management/DataOperationsSection';
import { EntityManagement } from './project-management/EntityManagementView';
import { ProjectManagementSidebar } from './project-management/ProjectManagementSidebar';
import { ProjectManagementSkeleton } from './project-management/ProjectManagementSkeleton';
import { ProjectShareDialog } from './project-management/ProjectShareDialog';
import { BreakdownDetailsDialog } from './projects/BreakdownDetailsDialog';
import type { ManagedProject, SectionId } from './project-management/types';

/**
 * The breakdown's settings surface: the entity levels and fields it captures, and the data
 * operations that move a breakdown's model in and out of the instance. Legitimately full-surface —
 * a schema editor is a tool, not a focused transient task — and addressed by
 * `/breakdowns/:id/manage/structure`.
 *
 * Sharing is not a section here and no longer renders under a modal on arrival (#176):
 * `/breakdowns/:id/manage` opens the breakdowns library with the share modal presented, exactly as
 * `/screenplays/:id/manage` does. This surface can still *raise* that modal over itself from its
 * header, the way the editors do, because managing an object should never mean leaving it.
 *
 * Moving a breakdown to trash left this surface with #176: destructive actions are confirmations
 * raised from the library row menu and the inspector, per the screenplay precedent.
 */
function ProjectManagementContent({
  projectId,
  project,
}: {
  projectId: string;
  project: ManagedProject;
}) {
  const [surface, setSurface] = useState<SectionId>('entities');
  const [selectedEntityTypeId, setSelectedEntityTypeId] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const permissions = project.currentMembership?.permissions ?? [];
  const canManageEntities = permissions.includes('manage_entity_types');
  const canManageFields = permissions.includes('manage_fields');
  const canManageSettings = permissions.includes('manage_project_settings');
  const dataOperationsController = useDataOperationsController({ projectId, project });

  useEffect(() => {
    setSelectedEntityTypeId((current) =>
      project.entityTypes.some((entityType) => entityType.id === current)
        ? current
        : (project.entityTypes[0]?.id ?? ''),
    );
  }, [project]);

  const selectSection = (nextSection: SectionId) => {
    setSurface(nextSection);
    if (nextSection === 'entities') {
      setSelectedEntityTypeId(project.entityTypes[0]?.id ?? '');
    }
  };
  const selectEntityType = (entityTypeId: string) => {
    setSurface('entities');
    setSelectedEntityTypeId(entityTypeId);
  };
  const busy = dataOperationsController.importProject.isPending;

  return (
    <main className={styles.page} aria-busy={busy}>
      <PanelHeader
        title="Breakdown settings"
        actions={
          <>
            <HeaderButton onClick={() => setDetailsOpen(true)}>
              <PencilSimpleIcon size={12} aria-hidden="true" /> Details…
            </HeaderButton>
            {canManageSettings && (
              <HeaderButton onClick={() => setShareOpen(true)}>
                <UsersThreeIcon size={12} aria-hidden="true" /> Share…
              </HeaderButton>
            )}
          </>
        }
      />
      <div className={styles.layout}>
        <ProjectManagementSidebar
          section={surface}
          entityTypes={project.entityTypes}
          selectedEntityTypeId={selectedEntityTypeId}
          onSelectSection={selectSection}
          onSelectEntityType={selectEntityType}
        />

        <div className={styles.content}>
          {surface === 'entities' && (
            <>
              <header className={styles.pageIntro}>
                <h1>
                  {project.entityTypes.find((entityType) => entityType.id === selectedEntityTypeId)
                    ?.pluralName ?? project.entityTypes[0]?.pluralName}
                </h1>
                <p>Manage this entity definition and the fields your team captures.</p>
              </header>
              <EntityManagement
                projectId={projectId}
                entityTypes={project.entityTypes}
                selectedId={selectedEntityTypeId}
                onSelectId={setSelectedEntityTypeId}
                canManageEntities={canManageEntities}
                canManageFields={canManageFields}
              />
            </>
          )}

          {surface === 'data' && <DataOperationsSection controller={dataOperationsController} />}
        </div>
      </div>
      {shareOpen && (
        <ProjectShareDialog projectId={projectId} onClose={() => setShareOpen(false)} />
      )}
      {detailsOpen && (
        <BreakdownDetailsDialog projectId={projectId} onClose={() => setDetailsOpen(false)} />
      )}
    </main>
  );
}

export function ProjectManagementScreen({ projectId }: { projectId: string }) {
  const project = useQuery({
    queryKey: ['project-management', projectId],
    queryFn: () => api<ManagedProject>(`/api/v1/projects/${projectId}/management`),
  });

  if (project.isLoading) return <ProjectManagementSkeleton />;
  if (!project.data || project.error) {
    return (
      <main className={styles.page}>
        <div className={styles.errorState} role="alert">
          <h1>Breakdown management could not be opened.</h1>
          <p>Check your access and service connection, then try again.</p>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => project.refetch()}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return <ProjectManagementContent projectId={projectId} project={project.data} />;
}
