import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { ModalShell, modalButtonStyles } from '../../components/ModalShell';
import {
  ScreenplayInvitationsSection,
  ScreenplayManagementDialogs,
  ScreenplayMembersSection,
  ScreenplayOwnershipSection,
  ScreenplayRolesSection,
} from './ScreenplayManagementSections';
import { useScreenplayManagement } from './useScreenplayManagement';
import type { ManagedScreenplay } from './types';
import styles from './ScreenplayManagement.module.css';

/**
 * Sharing a screenplay — members, invitations, roles, ownership — as a modal over whatever surface
 * raised it (#169).
 *
 * This replaces the `/screenplays/:id/manage` card-stack page. That URL still resolves: it opens
 * the screenplays library with this modal presented, so a shared link to a screenplay's sharing
 * settings keeps working while the desktop idiom (focused transient task = modal) is honoured.
 * Persistent detail — title, format, revisions, member roster — lives in the list inspector (#164);
 * renaming stays its own dialog; moving to trash is a confirmation.
 *
 * Every control is permission-aware through `useScreenplayManagement`, which reads the caller's
 * screenplay permissions from the management payload per the access-control ADR.
 */
function ScreenplayShareContent({
  screenplayId,
  screenplay,
  onClose,
}: {
  screenplayId: string;
  screenplay: ManagedScreenplay;
  onClose: () => void;
}) {
  const controller = useScreenplayManagement({
    screenplayId,
    screenplay,
    // Trashing is raised from the list and the editor as a confirmation, never from inside the
    // share modal, so this surface has no deletion to report.
    onDeleted: onClose,
  });
  const busy =
    controller.addMember.isPending ||
    controller.invite.isPending ||
    controller.changeMemberRole.isPending ||
    controller.removeMember.isPending ||
    controller.transferOwnership.isPending;
  return (
    <>
      <ModalShell
        config={{
          size: 'wide',
          regions: {
            header: { eyebrow: 'Share', title: screenplay.title },
            body: {
              description: <p>Control who can read and edit this screenplay.</p>,
              content: (
                <>
                  <ScreenplayMembersSection controller={controller} />
                  <ScreenplayInvitationsSection controller={controller} />
                  <ScreenplayRolesSection controller={controller} />
                  <ScreenplayOwnershipSection controller={controller} />
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
      <ScreenplayManagementDialogs controller={controller} />
    </>
  );
}

export function ScreenplayShareDialog({
  screenplayId,
  onClose,
}: {
  screenplayId: string;
  onClose: () => void;
}) {
  const management = useQuery({
    queryKey: ['screenplay-management', screenplayId],
    queryFn: () => api<ManagedScreenplay>(`/api/v1/screenplays/${screenplayId}/management`),
  });

  if (management.data && !management.error) {
    return (
      <ScreenplayShareContent
        screenplayId={screenplayId}
        screenplay={management.data}
        onClose={onClose}
      />
    );
  }
  return (
    <ModalShell
      config={{
        size: 'wide',
        regions: {
          header: { eyebrow: 'Share', title: 'Screenplay sharing' },
          body: {
            content: management.isLoading ? (
              <p className={styles.state}>Loading sharing settings…</p>
            ) : (
              <div className={styles.state} role="alert">
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
