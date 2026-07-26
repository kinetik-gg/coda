import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { api } from './api';
import { HeaderButton, PanelHeader } from './content-lists';
import styles from './ProjectManagementScreen.styles';
import {
  DataOperationsSection,
  useDataOperationsController,
} from './project-management/DataOperationsSection';
import { EntityManagement } from './project-management/EntityManagementView';
import { useOverviewController } from './project-management/OverviewSection';
import { ProjectInformationSection } from './project-management/OverviewView';
import { ProjectManagementSidebar } from './project-management/ProjectManagementSidebar';
import { ProjectManagementSkeleton } from './project-management/ProjectManagementSkeleton';
import { ProjectShareDialog } from './project-management/ProjectShareDialog';
import { projectManagementPath, type ProjectManagementSection } from './app-routing';
import type { ManagedProject, SectionId } from './project-management/types';

/**
 * The breakdown's settings surface: its information, the entity levels and fields it captures, and
 * its data operations. Legitimately full-surface — a schema editor is not a focused transient task
 * — but no longer a stack of cards, and no longer where sharing lives.
 *
 * Sharing is a modal presented over this surface, addressed by `/breakdowns/:id/manage` — the URL
 * that always landed on the members-and-roles overview. `/breakdowns/:id/manage/structure`
 * addresses this surface on its own, and is where dismissing the share modal lands (#169).
 */
function ProjectManagementContent({
  projectId,
  project,
  section,
  onNavigate,
  onDeleted,
}: {
  projectId: string;
  project: ManagedProject;
  section: ProjectManagementSection;
  onNavigate: (path: string) => void;
  onDeleted: () => void;
}) {
  const [surface, setSurface] = useState<SectionId>('overview');
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
    setSurface(nextSection);
    if (nextSection === 'entities') {
      setSelectedEntityTypeId(project.entityTypes[0]?.id ?? '');
    }
  };
  const selectEntityType = (entityTypeId: string) => {
    setSurface('entities');
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
      <PanelHeader
        title="Breakdown settings"
        actions={
          <HeaderButton onClick={() => onNavigate(projectManagementPath(projectId, 'share'))}>
            <UsersThreeIcon size={12} aria-hidden="true" /> Share…
          </HeaderButton>
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
          {surface === 'overview' && (
            <>
              <header className={styles.pageIntro}>
                <h1>{project.name}</h1>
                <p>This breakdown’s information. Who can work in it lives behind Share.</p>
              </header>
              <ProjectInformationSection controller={overviewController} />
            </>
          )}

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

          {surface === 'danger' && <DataOperationsSection controller={dataOperationsController} />}
        </div>
      </div>
      {section === 'share' && (
        <ProjectShareDialog
          controller={overviewController}
          onClose={() => onNavigate(projectManagementPath(projectId, 'structure'))}
        />
      )}
    </main>
  );
}

export function ProjectManagementScreen({
  projectId,
  section,
  onNavigate,
  onDeleted,
}: {
  projectId: string;
  section: ProjectManagementSection;
  onNavigate: (path: string) => void;
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

  return (
    <ProjectManagementContent
      projectId={projectId}
      project={project.data}
      section={section}
      onNavigate={onNavigate}
      onDeleted={onDeleted}
    />
  );
}
