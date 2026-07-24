import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { accountErrorMessage } from './AccountSections';
import type { AccountSession, MutationFeedback } from './types';
import styles from '../AccountScreen.module.css';

function formatSessionTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

interface SessionsSectionProps {
  sessions: AccountSession[];
  sessionsLoading: boolean;
  signOutMutation: MutationFeedback;
  onSignOutEverywhere: () => void;
  onRevoke: (session: AccountSession) => void;
}

export function SessionsSection({
  sessions,
  sessionsLoading,
  signOutMutation,
  onSignOutEverywhere,
  onRevoke,
}: SessionsSectionProps) {
  return (
    <section className={styles.formPanel}>
      <div className={styles.formHeading}>
        <h2>Active sessions</h2>
        <p>Devices currently signed in to your account. Revoking a session ends it immediately.</p>
      </div>
      <div className={styles.credentialList}>
        {sessions.map((session) => (
          <article key={session.id} data-current={session.isCurrent}>
            <div>
              <strong>{session.userAgentClass ?? 'Unknown device'}</strong>
              <span>Created {formatSessionTimestamp(session.createdAt)}</span>
            </div>
            <span>Last seen {formatSessionTimestamp(session.lastSeenAt)}</span>
            <span>{session.isCurrent ? 'This device' : ''}</span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => onRevoke(session)}
            >
              <TrashIcon size={12} aria-hidden="true" /> Revoke
            </button>
          </article>
        ))}
        {!sessionsLoading && !sessions.length && (
          <p className={styles.credentialEmpty}>No active sessions.</p>
        )}
      </div>
      <div className={styles.actions}>
        <div className={styles.formFeedback} aria-live="polite">
          {signOutMutation.error && (
            <span className={styles.error} role="alert">
              <WarningCircleIcon size={12} aria-hidden="true" />{' '}
              {accountErrorMessage(signOutMutation.error, 'Sessions could not be revoked.')}
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={signOutMutation.isPending}
          onClick={onSignOutEverywhere}
        >
          <SignOutIcon size={12} aria-hidden="true" />
          {signOutMutation.isPending ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </div>
    </section>
  );
}
