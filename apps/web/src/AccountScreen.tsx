import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountPreferences } from '@coda/contracts';
import { api } from './api';
import {
  applyAccountPreferences,
  defaultAccountPreferences,
  preferencesFromAccount,
} from './account-preferences';
import { AccountLoadingSkeleton, AccountLoadError } from './account/AccountSections';
import {
  AccountDialogs,
  AccountPageBody,
  AccountSidebar,
  useSessionsPanel,
  type AccountPageBodyProps,
} from './account/AccountScreenChrome';
import type { DeveloperSectionProps } from './account/AccountSections';
import { useCredentialsPanel } from './account/useCredentialsPanel';
import type {
  AccountProfile,
  AccountSession,
  ApiCredential,
  CredentialProject,
  ProfileFields,
} from './account/types';
import {
  validatePasswordFields,
  type AccountPage,
  type PasswordFields,
} from './account-validation';
import styles from './AccountScreen.module.css';

export { validatePasswordFields } from './account-validation';
export type { AccountPage } from './account-validation';

const emptyProfile: ProfileFields = {
  displayName: '',
  email: '',
  company: '',
  department: '',
};

const emptyPassword: PasswordFields = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

const pageDetails: Record<AccountPage, { title: string; description: string }> = {
  profile: {
    title: 'Profile',
    description: 'Manage the details other members see across your breakdowns.',
  },
  preferences: {
    title: 'Preferences',
    description: 'Choose how Coda looks and behaves for your account.',
  },
  security: {
    title: 'Security',
    description: 'Change the password used to sign in to this Coda instance.',
  },
  sessions: {
    title: 'Sessions',
    description: 'See where you are signed in and revoke access you no longer recognize.',
  },
  developer: {
    title: 'Developer',
    description: 'Create scoped credentials for the REST API and MCP server.',
  },
};

function AccountContentHeader({ page }: { page: AccountPage }) {
  return (
    <header className={styles.contentHeader}>
      <h1>{pageDetails[page].title}</h1>
      <p>{pageDetails[page].description}</p>
    </header>
  );
}

function anyPending(...states: boolean[]): boolean {
  return states.some(Boolean);
}

function profileFieldsFromAccount(account: AccountProfile): ProfileFields {
  return {
    displayName: account.displayName,
    email: account.email,
    company: account.company ?? '',
    department: account.department ?? '',
  };
}

function useAccountQueries(activePage: AccountPage) {
  const account = useQuery({
    queryKey: ['account'],
    queryFn: () => api<AccountProfile>('/api/v1/account'),
  });
  const credentialProjects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<CredentialProject[]>('/api/v1/projects'),
    enabled: activePage === 'developer',
  });
  const credentials = useQuery({
    queryKey: ['api-credentials'],
    queryFn: () => api<ApiCredential[]>('/api/v1/account/credentials'),
    enabled: activePage === 'developer',
  });
  const sessions = useQuery({
    queryKey: ['account-sessions'],
    queryFn: () => api<AccountSession[]>('/api/v1/account/sessions'),
    enabled: activePage === 'sessions',
  });
  return { account, credentialProjects, credentials, sessions };
}

function useAccountPage(page?: AccountPage, onPageChange?: (page: AccountPage) => void) {
  const [localPage, setLocalPage] = useState<AccountPage>('profile');
  const activePage = page ?? localPage;
  const setActivePage = (nextPage: AccountPage) => {
    setLocalPage(nextPage);
    onPageChange?.(nextPage);
  };
  return { activePage, setActivePage };
}

function developerPropsFrom(
  credentials: ReturnType<typeof useCredentialsPanel>,
  queries: Pick<ReturnType<typeof useAccountQueries>, 'credentialProjects' | 'credentials'>,
): DeveloperSectionProps {
  return {
    projectId: credentials.projectId,
    kind: credentials.kind,
    name: credentials.name,
    expiry: credentials.expiry,
    permissions: credentials.permissions,
    availablePermissions: credentials.availablePermissions,
    projects: queries.credentialProjects.data ?? [],
    projectsLoading: queries.credentialProjects.isLoading,
    credentials: queries.credentials.data ?? [],
    credentialsLoading: queries.credentials.isLoading,
    createdToken: credentials.createdToken,
    createMutation: credentials.create,
    onSubmit: credentials.submit,
    onProjectChange: credentials.chooseProject,
    onKindChange: credentials.setKind,
    onNameChange: credentials.setName,
    onExpiryChange: credentials.setExpiry,
    onPermissionsChange: credentials.setPermissions,
    onRevoke: credentials.setRevokeTarget,
  };
}

export function AccountScreen({
  page,
  embedded = false,
  onPageChange,
}: {
  page?: AccountPage;
  embedded?: boolean;
  onPageChange?: (page: AccountPage) => void;
} = {}) {
  const { activePage, setActivePage } = useAccountPage(page, onPageChange);
  const [profileFields, setProfileFields] = useState<ProfileFields>(emptyProfile);
  const [passwordFields, setPasswordFields] = useState<PasswordFields>(emptyPassword);
  const [preferences, setPreferences] = useState<AccountPreferences>(defaultAccountPreferences);
  const [passwordValidation, setPasswordValidation] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const sessionsPanel = useSessionsPanel(queryClient);

  const { account, credentialProjects, credentials, sessions } = useAccountQueries(activePage);
  const credentialsPanel = useCredentialsPanel(queryClient, credentialProjects.data);

  const { projectId: credentialProjectId, setProjectId: setCredentialProjectId } = credentialsPanel;
  useEffect(() => {
    if (!credentialProjectId && credentialProjects.data?.[0]) {
      setCredentialProjectId(credentialProjects.data[0].id);
    }
  }, [credentialProjectId, setCredentialProjectId, credentialProjects.data]);
  useEffect(() => {
    if (!account.data) return;
    setProfileFields(profileFieldsFromAccount(account.data));
    setPreferences(preferencesFromAccount(account.data));
  }, [account.data]);

  const updateProfile = useMutation({
    mutationFn: () =>
      api<AccountProfile>('/api/v1/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: profileFields.displayName.trim(),
          email: profileFields.email.trim(),
          company: profileFields.company.trim() || null,
          department: profileFields.department.trim() || null,
        }),
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(['account'], profile);
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
  const changePassword = useMutation({
    mutationFn: () =>
      api('/api/v1/account/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordFields.currentPassword,
          newPassword: passwordFields.newPassword,
        }),
      }),
    onSuccess: () => {
      setPasswordFields(emptyPassword);
      setPasswordValidation(null);
    },
  });
  const updatePreferences = useMutation({
    mutationFn: () =>
      api<Pick<AccountProfile, 'theme' | 'fontSize' | 'motionPreference' | 'pdfAppearance'>>(
        '/api/v1/account/preferences',
        { method: 'PATCH', body: JSON.stringify(preferences) },
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData<AccountProfile>(['account'], (current) =>
        current ? { ...current, ...saved } : current,
      );
      queryClient.setQueryData(['session'], (current: unknown) =>
        current && typeof current === 'object' ? { ...current, ...saved } : current,
      );
      applyAccountPreferences(preferencesFromAccount(saved));
    },
  });

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateProfile.reset();
    updateProfile.mutate();
  };
  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    changePassword.reset();
    const validation = validatePasswordFields(passwordFields);
    setPasswordValidation(validation);
    if (validation) return;
    changePassword.mutate();
  };
  const submitPreferences = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updatePreferences.reset();
    updatePreferences.mutate();
  };
  const updatePreference = <Key extends keyof AccountPreferences>(
    key: Key,
    value: AccountPreferences[Key],
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    if (updatePreferences.isSuccess || updatePreferences.isError) updatePreferences.reset();
  };
  const updateProfileField = (field: keyof ProfileFields, value: string) => {
    setProfileFields((current) => ({ ...current, [field]: value }));
    if (updateProfile.isSuccess || updateProfile.isError) updateProfile.reset();
  };
  const updatePasswordField = (field: keyof PasswordFields, value: string) => {
    setPasswordFields((current) => ({ ...current, [field]: value }));
    setPasswordValidation(null);
    if (changePassword.isSuccess || changePassword.isError) changePassword.reset();
  };

  const busy = anyPending(
    account.isLoading,
    ...[
      updateProfile,
      updatePreferences,
      changePassword,
      credentialsPanel.create,
      credentialsPanel.revoke,
      sessionsPanel.revokeSession,
      sessionsPanel.signOutEverywhere,
    ].map((mutation) => mutation.isPending),
  );
  const pageBodyProps: AccountPageBodyProps = {
    activePage,
    profileFields,
    updateProfile,
    onSubmitProfile: submitProfile,
    onProfileFieldChange: updateProfileField,
    preferences,
    updatePreferences,
    onSubmitPreferences: submitPreferences,
    onPreferenceChange: updatePreference,
    passwordFields,
    passwordValidation,
    changePassword,
    onSubmitPassword: submitPassword,
    onPasswordFieldChange: updatePasswordField,
    sessionsPanel,
    sessionsData: sessions.data,
    sessionsLoading: sessions.isLoading,
    developer: developerPropsFrom(credentialsPanel, { credentialProjects, credentials }),
  };

  return (
    <main className={`${styles.accountPage} ${embedded ? styles.embedded : ''}`} aria-busy={busy}>
      <div className={styles.accountShell}>
        {!embedded && <AccountSidebar activePage={activePage} onPageChange={setActivePage} />}
        <div className={styles.content}>
          <AccountContentHeader page={activePage} />
          {account.isLoading ? (
            <AccountLoadingSkeleton />
          ) : account.error || !account.data ? (
            <AccountLoadError retry={() => void account.refetch()} />
          ) : (
            <AccountPageBody {...pageBodyProps} />
          )}
        </div>
      </div>
      <AccountDialogs
        revokeTarget={credentialsPanel.revokeTarget}
        revokeCredential={credentialsPanel.revoke}
        onCancelRevokeCredential={() => credentialsPanel.setRevokeTarget(undefined)}
        onConfirmRevokeCredential={(target) => credentialsPanel.revoke.mutate(target.id)}
        sessionsPanel={sessionsPanel}
      />
    </main>
  );
}
