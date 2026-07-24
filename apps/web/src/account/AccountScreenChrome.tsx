import { useState } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { DevicesIcon } from '@phosphor-icons/react/dist/csr/Devices';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { UserCircleIcon } from '@phosphor-icons/react/dist/csr/UserCircle';
import type { AccountPreferences } from '@coda/contracts';
import type { FormEventHandler } from 'react';
import { api } from '../api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import {
  DeveloperSection,
  PreferencesSection,
  ProfileSection,
  SecuritySection,
  accountErrorMessage,
  type DeveloperSectionProps,
} from './AccountSections';
import { SessionsSection } from './SessionsSection';
import { TwoFactorSection } from './TwoFactorSection';
import type { AccountSession, ApiCredential, MutationFeedback, ProfileFields } from './types';
import type { AccountPage, PasswordFields } from '../account-validation';
import styles from '../AccountScreen.module.css';

export function RevokeCredentialDialog({
  target,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: ApiCredential;
  busy: boolean;
  error: Error | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmationDialog
      title="Revoke credential?"
      description={`“${target.name}” will stop working immediately.`}
      confirmLabel="Revoke credential"
      busy={busy}
      error={error ? accountErrorMessage(error, 'Credential could not be revoked.') : undefined}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function RevokeSessionDialog({
  target,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: AccountSession;
  busy: boolean;
  error: Error | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmationDialog
      title="Revoke session?"
      description={`This will sign out “${target.userAgentClass ?? 'this device'}” immediately.`}
      confirmLabel="Revoke session"
      busy={busy}
      error={error ? accountErrorMessage(error, 'Session could not be revoked.') : undefined}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function SignOutEverywhereDialog({
  includeCurrent,
  busy,
  error,
  onToggleIncludeCurrent,
  onCancel,
  onConfirm,
}: {
  includeCurrent: boolean;
  busy: boolean;
  error: Error | null;
  onToggleIncludeCurrent: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmationDialog
      title="Sign out everywhere?"
      description={
        <label className={styles.signOutOption}>
          <input
            type="checkbox"
            checked={includeCurrent}
            onChange={(event) => onToggleIncludeCurrent(event.target.checked)}
          />
          Every other session will be revoked. Also sign out this device?
        </label>
      }
      confirmLabel="Sign out"
      busy={busy}
      error={error ? accountErrorMessage(error, 'Sessions could not be revoked.') : undefined}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function useSessionsPanel(queryClient: QueryClient) {
  const [revokeSessionTarget, setRevokeSessionTarget] = useState<AccountSession>();
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const [signOutIncludeCurrent, setSignOutIncludeCurrent] = useState(false);

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) =>
      api(`/api/v1/account/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRevokeSessionTarget(undefined);
      void queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    },
  });
  const signOutEverywhere = useMutation({
    mutationFn: (keepCurrent: boolean) =>
      api('/api/v1/account/sessions/sign-out-everywhere', {
        method: 'POST',
        body: JSON.stringify({ keepCurrent }),
      }),
    onSuccess: () => {
      setSignOutDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    },
  });

  return {
    revokeSessionTarget,
    setRevokeSessionTarget,
    signOutDialogOpen,
    signOutIncludeCurrent,
    setSignOutIncludeCurrent,
    revokeSession,
    signOutEverywhere,
    openSignOutDialog: () => {
      setSignOutIncludeCurrent(false);
      setSignOutDialogOpen(true);
    },
    closeSignOutDialog: () => setSignOutDialogOpen(false),
  };
}

export type SessionsPanel = ReturnType<typeof useSessionsPanel>;

export function AccountDialogs({
  revokeTarget,
  revokeCredential,
  onCancelRevokeCredential,
  onConfirmRevokeCredential,
  sessionsPanel,
}: {
  revokeTarget: ApiCredential | undefined;
  revokeCredential: MutationFeedback;
  onCancelRevokeCredential: () => void;
  onConfirmRevokeCredential: (target: ApiCredential) => void;
  sessionsPanel: SessionsPanel;
}) {
  return (
    <>
      {revokeTarget && (
        <RevokeCredentialDialog
          target={revokeTarget}
          busy={revokeCredential.isPending}
          error={revokeCredential.error}
          onCancel={onCancelRevokeCredential}
          onConfirm={() => onConfirmRevokeCredential(revokeTarget)}
        />
      )}
      {sessionsPanel.revokeSessionTarget && (
        <RevokeSessionDialog
          target={sessionsPanel.revokeSessionTarget}
          busy={sessionsPanel.revokeSession.isPending}
          error={sessionsPanel.revokeSession.error}
          onCancel={() => sessionsPanel.setRevokeSessionTarget(undefined)}
          onConfirm={() =>
            sessionsPanel.revokeSession.mutate(sessionsPanel.revokeSessionTarget!.id)
          }
        />
      )}
      {sessionsPanel.signOutDialogOpen && (
        <SignOutEverywhereDialog
          includeCurrent={sessionsPanel.signOutIncludeCurrent}
          busy={sessionsPanel.signOutEverywhere.isPending}
          error={sessionsPanel.signOutEverywhere.error}
          onToggleIncludeCurrent={sessionsPanel.setSignOutIncludeCurrent}
          onCancel={sessionsPanel.closeSignOutDialog}
          onConfirm={() =>
            sessionsPanel.signOutEverywhere.mutate(!sessionsPanel.signOutIncludeCurrent)
          }
        />
      )}
    </>
  );
}

export function AccountSidebar({
  activePage,
  onPageChange,
}: {
  activePage: AccountPage;
  onPageChange: (page: AccountPage) => void;
}) {
  const pages = [
    { id: 'profile', label: 'Profile', Icon: UserCircleIcon },
    { id: 'preferences', label: 'Preferences', Icon: SlidersHorizontalIcon },
    { id: 'security', label: 'Security', Icon: LockKeyIcon },
    { id: 'sessions', label: 'Sessions', Icon: DevicesIcon },
    { id: 'developer', label: 'Developer', Icon: KeyIcon },
  ] as const;
  return (
    <aside className={styles.sidebar} aria-label="Account pages">
      <nav className={styles.sidebarNav}>
        {pages.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={styles.sidebarItem}
            aria-current={activePage === id ? 'page' : undefined}
            onClick={() => onPageChange(id)}
          >
            <Icon size={12} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export interface AccountPageBodyProps {
  activePage: AccountPage;
  profileFields: ProfileFields;
  updateProfile: MutationFeedback;
  onSubmitProfile: FormEventHandler<HTMLFormElement>;
  onProfileFieldChange: (field: keyof ProfileFields, value: string) => void;
  preferences: AccountPreferences;
  updatePreferences: MutationFeedback;
  onSubmitPreferences: FormEventHandler<HTMLFormElement>;
  onPreferenceChange: <Key extends keyof AccountPreferences>(
    key: Key,
    value: AccountPreferences[Key],
  ) => void;
  passwordFields: PasswordFields;
  passwordValidation: string | null;
  changePassword: MutationFeedback;
  onSubmitPassword: FormEventHandler<HTMLFormElement>;
  onPasswordFieldChange: (field: keyof PasswordFields, value: string) => void;
  sessionsPanel: SessionsPanel;
  sessionsData: AccountSession[] | undefined;
  sessionsLoading: boolean;
  developer: DeveloperSectionProps;
}

export function AccountPageBody({
  activePage,
  profileFields,
  updateProfile,
  onSubmitProfile,
  onProfileFieldChange,
  preferences,
  updatePreferences,
  onSubmitPreferences,
  onPreferenceChange,
  passwordFields,
  passwordValidation,
  changePassword,
  onSubmitPassword,
  onPasswordFieldChange,
  sessionsPanel,
  sessionsData,
  sessionsLoading,
  developer,
}: AccountPageBodyProps) {
  if (activePage === 'profile') {
    return (
      <ProfileSection
        fields={profileFields}
        mutation={updateProfile}
        onSubmit={onSubmitProfile}
        onFieldChange={onProfileFieldChange}
      />
    );
  }
  if (activePage === 'preferences') {
    return (
      <PreferencesSection
        preferences={preferences}
        mutation={updatePreferences}
        onSubmit={onSubmitPreferences}
        onChange={onPreferenceChange}
      />
    );
  }
  if (activePage === 'security') {
    return (
      <div className={styles.developerStack}>
        <SecuritySection
          fields={passwordFields}
          validation={passwordValidation}
          mutation={changePassword}
          onSubmit={onSubmitPassword}
          onFieldChange={onPasswordFieldChange}
        />
        <TwoFactorSection />
      </div>
    );
  }
  if (activePage === 'sessions') {
    return (
      <SessionsSection
        sessions={sessionsData ?? []}
        sessionsLoading={sessionsLoading}
        signOutMutation={sessionsPanel.signOutEverywhere}
        onSignOutEverywhere={sessionsPanel.openSignOutDialog}
        onRevoke={sessionsPanel.setRevokeSessionTarget}
      />
    );
  }
  return <DeveloperSection {...developer} />;
}
