import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ModalShell, modalButtonStyles } from '../components/ModalShell';
import styles from '../ProjectManagementScreen.styles';
import {
  DataOperationsSection,
  useDataOperationsController,
  type DataOperationsController,
} from './DataOperationsSection';
import { EntityManagement } from './EntityManagementView';
import {
  ProjectDangerSection,
  useProjectDangerController,
  type ProjectDangerController,
} from './ProjectDangerSection';
import { ProjectDetailsSection } from './ProjectDetailsSection';
import {
  useProjectDetailsController,
  type ProjectDetailsController,
} from './useProjectDetailsController';
import { ProjectManagementNavigation } from './ProjectManagementSidebar';
import { useOverviewController, type OverviewController } from './OverviewSection';
import {
  ProjectInvitationsSection,
  ProjectMembersSection,
  ProjectRolesSection,
  ProjectShareConfirmations,
} from './OverviewView';
import type { ManagedProject, SectionId } from './types';

interface ManagementControllers {
  share: OverviewController;
  details: ProjectDetailsController;
  data: DataOperationsController;
  danger: ProjectDangerController;
}

function controllersBusy(controllers: ManagementControllers): boolean {
  const { share, details, data, danger } = controllers;
  return (
    share.addMember.isPending ||
    share.invite.isPending ||
    share.changeMemberRole.isPending ||
    share.removeMember.isPending ||
    share.createRole.isPending ||
    share.archiveRole.isPending ||
    details.save.isPending ||
    data.importProject.isPending ||
    danger.moveToTrash.isPending
  );
}

function ShareSection({ controller }: { controller: OverviewController }) {
  return (
    <section aria-labelledby="project-management-share-title">
      <header className={styles.pageIntro}>
        <h1 id="project-management-share-title">Share</h1>
        <p>Manage members, pending invitations, roles, and permissions for this breakdown.</p>
      </header>
      <ProjectMembersSection controller={controller} />
      <ProjectInvitationsSection controller={controller} />
      <ProjectRolesSection controller={controller} />
    </section>
  );
}

function StructureSection({
  projectId,
  project,
  selectedEntityTypeId,
  onSelectEntityType,
}: {
  projectId: string;
  project: ManagedProject;
  selectedEntityTypeId: string;
  onSelectEntityType: (entityTypeId: string) => void;
}) {
  const permissions = project.currentMembership?.permissions ?? [];
  return (
    <section aria-labelledby="project-management-structure-title">
      <header className={styles.pageIntro}>
        <h1 id="project-management-structure-title">Entities &amp; fields</h1>
        <p>Manage hierarchy levels and the fields your team captures at each level.</p>
      </header>
      <EntityManagement
        projectId={projectId}
        entityTypes={project.entityTypes}
        selectedId={selectedEntityTypeId}
        onSelectId={onSelectEntityType}
        canManageEntities={permissions.includes('manage_entity_types')}
        canManageFields={permissions.includes('manage_fields')}
      />
    </section>
  );
}

function ActiveManagementSection({
  section,
  projectId,
  project,
  selectedEntityTypeId,
  onSelectEntityType,
  controllers,
  sourceSpaceId,
}: {
  section: SectionId;
  projectId: string;
  project: ManagedProject;
  selectedEntityTypeId: string;
  onSelectEntityType: (entityTypeId: string) => void;
  controllers: ManagementControllers;
  sourceSpaceId?: string;
}) {
  switch (section) {
    case 'share':
      return <ShareSection controller={controllers.share} />;
    case 'details':
      return <ProjectDetailsSection controller={controllers.details} />;
    case 'structure':
      return (
        <StructureSection
          projectId={projectId}
          project={project}
          selectedEntityTypeId={selectedEntityTypeId}
          onSelectEntityType={onSelectEntityType}
        />
      );
    case 'data':
      return <DataOperationsSection controller={controllers.data} />;
    case 'danger':
      return (
        <ProjectDangerSection
          project={project}
          controller={controllers.danger}
          sourceSpaceId={sourceSpaceId}
        />
      );
  }
}

function ProjectManagementContent({
  projectId,
  project,
  section,
  onSectionChange,
  onClose,
  onDeleted,
  sourceSpaceId,
}: ProjectManagementModalProps & { project: ManagedProject }) {
  const [selectedEntityTypeId, setSelectedEntityTypeId] = useState(
    project.entityTypes[0]?.id ?? '',
  );
  useEffect(() => {
    setSelectedEntityTypeId((current) =>
      project.entityTypes.some((entityType) => entityType.id === current)
        ? current
        : (project.entityTypes[0]?.id ?? ''),
    );
  }, [project]);

  const permissions = project.currentMembership?.permissions ?? [];
  const controllers: ManagementControllers = {
    share: useOverviewController({ projectId, project, permissions }),
    details: useProjectDetailsController({ projectId, project }),
    data: useDataOperationsController({ projectId, project }),
    danger: useProjectDangerController({ project, onDeleted }),
  };
  const selectSection = (nextSection: SectionId) => {
    if (nextSection === 'structure' && !selectedEntityTypeId) {
      setSelectedEntityTypeId(project.entityTypes[0]?.id ?? '');
    }
    onSectionChange(nextSection);
  };
  const selectEntityType = (entityTypeId: string) => {
    setSelectedEntityTypeId(entityTypeId);
    if (section !== 'structure') onSectionChange('structure');
  };

  return (
    <>
      <ModalShell
        config={{
          size: 'large',
          layout: {
            type: 'sections',
            navigationLabel: 'Breakdown management sections',
            navigation: (
              <ProjectManagementNavigation
                section={section}
                entityTypes={project.entityTypes}
                selectedEntityTypeId={selectedEntityTypeId}
                onSelectSection={selectSection}
                onSelectEntityType={selectEntityType}
              />
            ),
          },
          regions: {
            header: { title: project.name },
            body: {
              content: (
                <ActiveManagementSection
                  section={section}
                  projectId={projectId}
                  project={project}
                  selectedEntityTypeId={selectedEntityTypeId}
                  onSelectEntityType={selectEntityType}
                  controllers={controllers}
                  sourceSpaceId={sourceSpaceId}
                />
              ),
            },
            footer: (
              <button type="button" className={modalButtonStyles.primary} onClick={onClose}>
                Done
              </button>
            ),
          },
          dismissal: { onDismiss: onClose, busy: controllersBusy(controllers) },
        }}
      />
      <ProjectShareConfirmations controller={controllers.share} />
    </>
  );
}

export interface ProjectManagementModalProps {
  projectId: string;
  section: SectionId;
  onSectionChange: (section: SectionId) => void;
  onClose: () => void;
  onDeleted: () => void;
  sourceSpaceId?: string;
}

function ProjectManagementStateModal({
  title,
  message,
  onClose,
  retry,
}: {
  title: string;
  message: string;
  onClose: () => void;
  retry?: () => void;
}) {
  return (
    <ModalShell
      config={{
        size: 'large',
        regions: {
          header: { title },
          body: {
            content: (
              <div className={styles.errorState} role={retry ? 'alert' : 'status'}>
                <p>{message}</p>
                {retry && (
                  <button type="button" className={styles.secondaryButton} onClick={retry}>
                    Retry
                  </button>
                )}
              </div>
            ),
          },
        },
        dismissal: { onDismiss: onClose },
      }}
    />
  );
}

/** The single breakdown management modal, controlled by route or in-workspace section state. */
export function ProjectManagementModal(props: ProjectManagementModalProps) {
  const project = useQuery({
    queryKey: ['project-management', props.projectId],
    queryFn: () => api<ManagedProject>(`/api/v1/projects/${props.projectId}/management`),
  });

  if (project.isLoading) {
    return (
      <ProjectManagementStateModal
        title="Breakdown management"
        message="Loading breakdown management…"
        onClose={props.onClose}
      />
    );
  }
  if (!project.data || project.error) {
    return (
      <ProjectManagementStateModal
        title="Breakdown management"
        message="Breakdown management could not be opened. Check your access and service connection."
        onClose={props.onClose}
        retry={() => void project.refetch()}
      />
    );
  }
  return <ProjectManagementContent {...props} project={project.data} />;
}
