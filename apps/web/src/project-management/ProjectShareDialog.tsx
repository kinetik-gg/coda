import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ModalShell, modalButtonStyles } from '../components/ModalShell';
import { useOverviewController, type OverviewController } from './OverviewSection';
import {
  ProjectInvitationsSection,
  ProjectMembersSection,
  ProjectRolesSection,
  ProjectShareConfirmations,
} from './OverviewView';
import type { ManagedProject } from './types';
import styles from '../ProjectManagementScreen.styles';

/**
 * Sharing a breakdown — members, roles, and permissions — as a modal over whatever surface raised
 * it (#169, #176).
 *
 * `/breakdowns/:id/manage` used to land on a stacked-card "Overview" page, and then briefly on the
 * settings surface with this modal floating over it. It now opens the breakdowns *library* with
 * this modal presented — the exact analogue of `/screenplays/:id/manage` — so a shared link to a
 * breakdown's sharing settings keeps working while the operation itself stays the focused task it
 * always was, with nothing management-shaped rendered underneath.
 *
 * Every control is permission-aware through `useOverviewController`, which reads the caller's
 * project permissions from the management payload per the access-control ADR.
 */
export function ProjectShareModal({
  controller,
  onClose,
}: {
  controller: OverviewController;
  onClose: () => void;
}) {
  const busy =
    controller.addMember.isPending ||
    controller.invite.isPending ||
    controller.changeMemberRole.isPending ||
    controller.removeMember.isPending ||
    controller.createRole.isPending ||
    controller.archiveRole.isPending;
  return (
    <>
      <ModalShell
        config={{
          size: 'wide',
          regions: {
            header: { eyebrow: 'Share', title: controller.project.name },
            body: {
              description: (
                <p>Control who can work in this breakdown, and what each role may do.</p>
              ),
              content: (
                <>
                  <ProjectMembersSection controller={controller} />
                  <ProjectInvitationsSection controller={controller} />
                  <ProjectRolesSection controller={controller} />
                </>
              ),
            },
            footer: (
              <button type="button" className={modalButtonStyles.primary} onClick={onClose}>
                Done
              </button>
            ),
          },
          dismissal: { onDismiss: onClose, busy },
        }}
      />
      <ProjectShareConfirmations controller={controller} />
    </>
  );
}

function ProjectShareContent({
  projectId,
  project,
  onClose,
}: {
  projectId: string;
  project: ManagedProject;
  onClose: () => void;
}) {
  const controller = useOverviewController({
    projectId,
    project,
    permissions: project.currentMembership?.permissions ?? [],
  });
  return <ProjectShareModal controller={controller} onClose={onClose} />;
}

/**
 * The breakdown share modal, reading its own management payload.
 *
 * Every surface that can raise it — the library, the breakdown workspace, the structure surface —
 * mounts it the same way: an id and a close handler, nothing else. That is exactly what
 * `ScreenplayShareDialog` asks of its callers, which is what makes the two object types behave
 * identically from the caller's side as well as the user's (#176).
 */
export function ProjectShareDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const management = useQuery({
    queryKey: ['project-management', projectId],
    queryFn: () => api<ManagedProject>(`/api/v1/projects/${projectId}/management`),
  });

  if (management.data && !management.error) {
    return (
      <ProjectShareContent projectId={projectId} project={management.data} onClose={onClose} />
    );
  }
  return (
    <ModalShell
      config={{
        size: 'wide',
        regions: {
          header: { eyebrow: 'Share', title: 'Breakdown sharing' },
          body: {
            content: management.isLoading ? (
              <p className={styles.inlineHelp}>Loading sharing settings…</p>
            ) : (
              <div className={styles.inlineHelp} role="alert">
                <p>Sharing could not be opened.</p>
                <p>Check your access and service connection, then try again.</p>
              </div>
            ),
          },
          footer: (
            <>
              {management.error && (
                <button
                  type="button"
                  className={modalButtonStyles.secondary}
                  onClick={() => void management.refetch()}
                >
                  Try again
                </button>
              )}
              <button type="button" className={modalButtonStyles.primary} onClick={onClose}>
                Close
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onClose },
      }}
    />
  );
}
