import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { api } from '../../api';
import { HeaderButton, PanelHeader } from '../../content-lists';
import {
  ScreenplayDangerSection,
  ScreenplayInfoSection,
  ScreenplayInvitationsSection,
  ScreenplayManagementDialogs,
  ScreenplayMembersSection,
  ScreenplayOwnershipSection,
  ScreenplayRolesSection,
} from './ScreenplayManagementSections';
import { useScreenplayManagement } from './useScreenplayManagement';
import type { ManagedScreenplay } from './types';
import styles from './ScreenplayManagement.module.css';

function ScreenplayManagementContent({
  screenplayId,
  screenplay,
  onBack,
  onDeleted,
}: {
  screenplayId: string;
  screenplay: ManagedScreenplay;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const controller = useScreenplayManagement({ screenplayId, screenplay, onDeleted });
  const busy =
    controller.updateTitle.isPending ||
    controller.addMember.isPending ||
    controller.invite.isPending ||
    controller.changeMemberRole.isPending ||
    controller.removeMember.isPending ||
    controller.transferOwnership.isPending ||
    controller.trashScreenplay.isPending;
  return (
    <section className={styles.page} aria-busy={busy}>
      <PanelHeader
        title="Manage screenplay"
        actions={
          <HeaderButton onClick={onBack}>
            <ArrowLeftIcon size={12} aria-hidden="true" /> Back to editor
          </HeaderButton>
        }
      />
      <div className={styles.body}>
        <div className={styles.column}>
          <header className={styles.pageIntro}>
            <h1>{screenplay.title}</h1>
            <p>
              Control who can read and edit this screenplay. <small>{screenplay.filename}</small>
            </p>
          </header>
          <ScreenplayInfoSection controller={controller} />
          <ScreenplayMembersSection controller={controller} />
          <ScreenplayInvitationsSection controller={controller} />
          <ScreenplayRolesSection controller={controller} />
          <ScreenplayOwnershipSection controller={controller} />
          <ScreenplayDangerSection controller={controller} />
          <ScreenplayManagementDialogs controller={controller} />
        </div>
      </div>
    </section>
  );
}

export function ScreenplayManagementScreen({
  screenplayId,
  onBack,
  onDeleted,
}: {
  screenplayId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const management = useQuery({
    queryKey: ['screenplay-management', screenplayId],
    queryFn: () => api<ManagedScreenplay>(`/api/v1/screenplays/${screenplayId}/management`),
  });

  if (management.isLoading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>Loading screenplay management…</div>
      </section>
    );
  }
  if (!management.data || management.error) {
    return (
      <section className={styles.page}>
        <div className={styles.state} role="alert">
          <h1>Screenplay management could not be opened.</h1>
          <p>Check your access and service connection, then try again.</p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void management.refetch()}
          >
            Retry
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onBack}>
            Back to editor
          </button>
        </div>
      </section>
    );
  }
  return (
    <ScreenplayManagementContent
      screenplayId={screenplayId}
      screenplay={management.data}
      onBack={onBack}
      onDeleted={onDeleted}
    />
  );
}
