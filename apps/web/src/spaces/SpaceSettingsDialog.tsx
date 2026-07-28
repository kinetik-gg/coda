import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WarningOctagonIcon } from '@phosphor-icons/react/dist/csr/WarningOctagon';
import { api } from '../api';
import { ModalShell, modalButtonStyles } from '../components/ModalShell';
import styles from '../ProjectManagementScreen.styles';
import { DangerSection } from './SpaceSettingsDanger';
import {
  DetailsSection,
  InvitationsSection,
  MembersSection,
  RolesSection,
} from './SpaceSettingsSections';
import type { ManagedSpace } from './space-settings-model';

type SectionId = 'details' | 'members' | 'roles' | 'invitations' | 'danger';

function Navigation({
  section,
  select,
}: {
  section: SectionId;
  select: (section: SectionId) => void;
}) {
  const labels: Array<[SectionId, string]> = [
    ['details', 'Details'],
    ['members', 'Members'],
    ['roles', 'Roles'],
    ['invitations', 'Invitations'],
    ['danger', 'Danger'],
  ];
  return (
    <nav className={styles.sidebarNav} aria-label="Space settings sections">
      {labels.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={styles.sidebarButton}
          aria-current={section === id ? 'page' : undefined}
          onClick={() => select(id)}
        >
          <WarningOctagonIcon size={12} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Content({ space, onClose }: { space: ManagedSpace; onClose: () => void }) {
  const [section, setSection] = useState<SectionId>('details');
  const body =
    section === 'details' ? (
      <DetailsSection space={space} />
    ) : section === 'members' ? (
      <MembersSection space={space} />
    ) : section === 'roles' ? (
      <RolesSection space={space} />
    ) : section === 'invitations' ? (
      <InvitationsSection space={space} />
    ) : (
      <DangerSection space={space} onDeleted={onClose} />
    );
  return (
    <ModalShell
      config={{
        size: 'large',
        layout: {
          type: 'sections',
          navigationLabel: 'Space settings sections',
          navigation: <Navigation section={section} select={setSection} />,
        },
        regions: {
          header: { title: space.name },
          body: { content: body },
          footer: (
            <button type="button" className={modalButtonStyles.primary} onClick={onClose}>
              Done
            </button>
          ),
        },
        dismissal: { onDismiss: onClose },
      }}
    />
  );
}

export function SpaceSettingsDialog({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const management = useQuery({
    queryKey: ['space-management', spaceId],
    queryFn: () => api<ManagedSpace>(`/api/v1/spaces/${spaceId}/management`),
  });
  if (management.isLoading)
    return (
      <ModalShell
        config={{
          regions: {
            header: { title: 'Space settings' },
            body: { content: <p>Loading Space settings…</p> },
          },
          dismissal: { onDismiss: onClose },
        }}
      />
    );
  if (!management.data || management.error)
    return (
      <ModalShell
        config={{
          regions: {
            header: { title: 'Space settings' },
            body: {
              content: (
                <div className={styles.errorState}>
                  <p>
                    Space settings could not be opened. Check your access and service connection.
                  </p>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void management.refetch()}
                  >
                    Retry
                  </button>
                </div>
              ),
            },
          },
          dismissal: { onDismiss: onClose },
        }}
      />
    );
  return <Content space={management.data} onClose={onClose} />;
}
