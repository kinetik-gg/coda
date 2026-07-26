import { ModalShell, modalButtonStyles } from '../components/ModalShell';
import type { OverviewController } from './OverviewSection';
import {
  ProjectMembersSection,
  ProjectRolesSection,
  ProjectShareConfirmations,
} from './OverviewView';

/**
 * Sharing a breakdown — members, roles, and permissions — as a modal (#169).
 *
 * `/breakdowns/:id/manage` used to land on a stacked-card "Overview" page holding exactly this
 * content. The URL still resolves; it now opens the breakdown's settings surface with this modal
 * presented, so a shared link to a breakdown's sharing settings keeps working while the operation
 * itself becomes the focused task it always was.
 *
 * Every control is permission-aware through `useOverviewController`, which reads the caller's
 * project permissions from the management payload per the access-control ADR.
 */
export function ProjectShareDialog({
  controller,
  onClose,
}: {
  controller: OverviewController;
  onClose: () => void;
}) {
  const busy =
    controller.addMember.isPending ||
    controller.changeMemberRole.isPending ||
    controller.removeMember.isPending ||
    controller.createRole.isPending ||
    controller.archiveRole.isPending;
  return (
    <>
      <ModalShell
        size="wide"
        eyebrow="Share"
        title={controller.project.name}
        description={<p>Control who can work in this breakdown, and what each role may do.</p>}
        busy={busy}
        onClose={onClose}
        footer={
          <button type="button" className={modalButtonStyles.primary} onClick={onClose}>
            Done
          </button>
        }
      >
        <ProjectMembersSection controller={controller} />
        <ProjectRolesSection controller={controller} />
      </ModalShell>
      <ProjectShareConfirmations controller={controller} />
    </>
  );
}
