import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import styles from './ProjectManagementScreen.module.css';
import {
  DataOperationsSection,
  useDataOperationsController,
} from './project-management/DataOperationsSection';
import { EntityManagement } from './project-management/EntityManagementView';
import { useOverviewController } from './project-management/OverviewSection';
import { OverviewSection } from './project-management/OverviewView';
import { ProjectManagementSidebar } from './project-management/ProjectManagementSidebar';
import { ProjectManagementSkeleton } from './project-management/ProjectManagementSkeleton';
import type { ManagedProject, SectionId } from './project-management/types';

function ProjectManagementContent({
  projectId,
  project,
  onDeleted,
}: {
  projectId: string;
  project: ManagedProject;
  onDeleted: () => void;
}) {
  const [section, setSection] = useState<SectionId>('overview');
  const [selectedEntityTypeId, setSelectedEntityTypeId] = useState('');
  const permissions = project.currentMembership?.permissions ?? [];
  const canManageEntities = permissions.includes('manage_entity_types');
  const canManageFields = permissions.includes('manage_fields');
  const canDeleteProject = permissions.includes('delete_project');
  const currentMember = project.memberships.find(
    (membership) => membership.id === project.currentMembership?.id,
  );
  const isOwner = currentMember?.user.id === project.ownerUserId;
  const overviewController = useOverviewController({ projectId, project, permissions });
  const dataOperationsController = useDataOperationsController({
    projectId,
    project,
    canDeleteProject,
    isOwner,
    onDeleted,
  });

  useEffect(() => {
    setSelectedEntityTypeId((current) =>
      project.entityTypes.some((entityType) => entityType.id === current)
        ? current
        : (project.entityTypes[0]?.id ?? ''),
    );
  }, [project]);

  const selectSection = (nextSection: SectionId) => {
    setSection(nextSection);
    if (nextSection === 'entities') {
      setSelectedEntityTypeId(project.entityTypes[0]?.id ?? '');
    }
  };
  const selectEntityType = (entityTypeId: string) => {
    setSection('entities');
    setSelectedEntityTypeId(entityTypeId);
  };
  const busy =
    overviewController.updateProject.isPending ||
    overviewController.addMember.isPending ||
    overviewController.changeMemberRole.isPending ||
    overviewController.removeMember.isPending ||
    overviewController.createRole.isPending ||
    overviewController.archiveRole.isPending ||
    dataOperationsController.importProject.isPending ||
    dataOperationsController.deleteProject.isPending;

  return (
    <main className={styles.page} aria-busy={busy}>
      <div className={styles.layout}>
        <ProjectManagementSidebar
          section={section}
          entityTypes={project.entityTypes}
          selectedEntityTypeId={selectedEntityTypeId}
          onSelectSection={selectSection}
          onSelectEntityType={selectEntityType}
        />

        <div className={styles.content}>
          {section === 'overview' && <OverviewSection controller={overviewController} />}

          {section === 'entities' && (
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

          {section === 'danger' && <DataOperationsSection controller={dataOperationsController} />}
        </div>
      </div>
    </main>
  );
}

export function ProjectManagementScreen({
  projectId,
  onDeleted,
}: {
  projectId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const project = useQuery({
    queryKey: ['project-management', projectId],
    queryFn: () => api<ManagedProject>(`/api/v1/projects/${projectId}/management`),
  });

  if (project.isLoading) return <ProjectManagementSkeleton />;
  if (!project.data || project.error) {
    return (
      <main className={styles.page}>
        <div className={styles.errorState} role="alert">
          <h1>Project management could not be opened.</h1>
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

  return (
    <ProjectManagementContent projectId={projectId} project={project.data} onDeleted={onDeleted} />
  );
}
