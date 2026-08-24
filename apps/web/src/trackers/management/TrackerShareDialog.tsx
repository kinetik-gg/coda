import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrackerManagement } from '../../api';
import { ModalShell, modalButtonStyles } from '../../components/ModalShell';
import { MoveToSpaceDialog } from '../../spaces/MoveToSpaceDialog';
import {
  TrackerManagementDialogs,
  TrackerMembersSection,
  TrackerInvitationsSection,
  TrackerOwnershipSection,
} from './TrackerManagementSections';
import { TrackerRolesSection } from './TrackerRoleSections';
import { useTrackerManagement } from './useTrackerManagement';
import type { ManagedTracker } from './types';
import styles from './TrackerManagement.module.css';

/**
 * Sharing a tracker — members, invitations, custom roles, ownership — as a modal over whatever
 * surface raised it, mirroring the screenplay share modal (#169). `/trackers/:id/manage` presents
 * it over the tracker library, so a shared link keeps working while the desktop idiom (focused
 * transient task = modal) is honoured (#381).
 *
 * Every control is permission-aware through `useTrackerManagement`, which reads the caller's
 * tracker permissions from the management payload per the access-control ADR; roles CRUD beyond
 * the caller's own grants is hidden or locked, and the API's subset rule remains the authority.
 */
function TrackerShareContent({
  tracker,
  onClose,
  sourceSpaceId,
}: {
  tracker: ManagedTracker;
  onClose: () => void;
  sourceSpaceId?: string;
}) {
  const [moving, setMoving] = useState(false);
  const controller = useTrackerManagement({ tracker });
  const busy =
    controller.addMember.isPending ||
    controller.invite.isPending ||
    controller.changeMemberRole.isPending ||
    controller.removeMember.isPending ||
    controller.revokeInvitation.isPending ||
    controller.createRole.isPending ||
    controller.archiveRole.isPending ||
    controller.transferOwnership.isPending;
  return (
    <>
      <ModalShell
        config={{
          size: 'wide',
          regions: {
            header: { title: tracker.name },
            body: {
              description: <p>Control who can read and edit this tracker.</p>,
              content: (
                <>
                  <TrackerMembersSection controller={controller} />
                  <TrackerInvitationsSection controller={controller} />
                  <TrackerRolesSection controller={controller} />
                  <TrackerOwnershipSection controller={controller} />
                  {sourceSpaceId && (
                    <section className={styles.section} aria-label="Move to Space">
                      <div className={styles.sectionHeading}>
                        <div>
                          <h3>Move to Space</h3>
                          <p>Review who gains or loses access before relocating this tracker.</p>
                        </div>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => setMoving(true)}
                        >
                          Move to Space…
                        </button>
                      </div>
                    </section>
                  )}
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
      <TrackerManagementDialogs controller={controller} />
      {moving && sourceSpaceId && (
        <MoveToSpaceDialog
          resourceType="tracker"
          resourceId={tracker.id}
          resourceName={tracker.name}
          sourceSpaceId={sourceSpaceId}
          onClose={() => setMoving(false)}
        />
      )}
    </>
  );
}

export function TrackerShareDialog({
  trackerId,
  onClose,
  sourceSpaceId,
}: {
  trackerId: string;
  onClose: () => void;
  sourceSpaceId?: string;
}) {
  const management = useQuery({
    queryKey: ['tracker-management', trackerId],
    queryFn: () => getTrackerManagement(trackerId),
  });

  if (management.data && !management.error) {
    return (
      <TrackerShareContent
        tracker={management.data}
        sourceSpaceId={sourceSpaceId}
        onClose={onClose}
      />
    );
  }
  return (
    <ModalShell
      config={{
        size: 'wide',
        regions: {
          header: { title: 'Tracker sharing' },
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
