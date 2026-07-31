import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WarningOctagonIcon } from '@phosphor-icons/react/dist/csr/WarningOctagon';
import { api, ApiError } from '../api';
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

/**
 * Why the settings could not be opened, in the user's terms. An authorization refusal is a
 * settled answer, not a hiccup: saying "check your service connection" and offering Retry sent
 * people round a loop that could never resolve (#334), so those two outcomes state the reason and
 * drop the button. Only a genuinely unknown failure — a dropped connection, a 500 — keeps it.
 */
function failureNotice(error: unknown): { lines: string[]; canRetry: boolean } {
  const status = error instanceof ApiError ? error.problem.status : null;
  if (status === 403) {
    return {
      lines: [
        'You do not have permission to open settings for this Space.',
        'Space settings are managed by a Space manager, or by the instance administrator for the Default Space.',
      ],
      canRetry: false,
    };
  }
  if (status === 404) {
    return {
      lines: ['This Space no longer exists, or it is not shared with you.'],
      canRetry: false,
    };
  }
  return {
    lines: ['Space settings could not be opened. Check your service connection, then try again.'],
    canRetry: true,
  };
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
    // An answered request is answered; only an unexplained failure is worth asking again.
    retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 3,
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
  if (!management.data || management.error) {
    const notice = failureNotice(management.error);
    return (
      <ModalShell
        config={{
          regions: {
            header: { title: 'Space settings' },
            body: {
              content: (
                <div className={styles.errorState} role="alert">
                  {notice.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  {notice.canRetry && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => void management.refetch()}
                    >
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
  return <Content space={management.data} onClose={onClose} />;
}
