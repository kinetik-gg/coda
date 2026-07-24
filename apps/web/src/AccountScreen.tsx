import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { UserCircleIcon } from '@phosphor-icons/react/dist/csr/UserCircle';
import type { AccountPreferences, Permission } from '@coda/contracts';
import { api } from './api';
import {
  applyAccountPreferences,
  defaultAccountPreferences,
  preferencesFromAccount,
} from './account-preferences';
import {
  AccountLoadingSkeleton,
  AccountLoadError,
  DeveloperSection,
  PreferencesSection,
  ProfileSection,
  SecuritySection,
  accountErrorMessage,
} from './account/AccountSections';
import type {
  AccountProfile,
  ApiCredential,
  CredentialProject,
  ProfileFields,
} from './account/types';
import {
  credentialExpiration,
  validatePasswordFields,
  type AccountPage,
  type PasswordFields,
} from './account-validation';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { TwoFactorSection } from './account/TwoFactorSection';
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

const defaultCredentialPermissions: Permission[] = ['read_project'];

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
  developer: {
    title: 'Developer',
    description: 'Create scoped credentials for the REST API and MCP server.',
  },
};

function SecurityPage(props: Parameters<typeof SecuritySection>[0]) {
  return (
    <div className={styles.developerStack}>
      <SecuritySection {...props} />
      <TwoFactorSection />
    </div>
  );
}

function AccountContentHeader({ page }: { page: AccountPage }) {
  return (
    <header className={styles.contentHeader}>
      <h1>{pageDetails[page].title}</h1>
      <p>{pageDetails[page].description}</p>
    </header>
  );
}

function RevokeCredentialDialog({
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

function anyPending(...states: boolean[]): boolean {
  return states.some(Boolean);
}

function permissionsForProject(projects: CredentialProject[] | undefined, projectId: string) {
  return (
    projects
      ?.find((project) => project.id === projectId)
      ?.currentMembership?.role.permissions.map((entry) => entry.permission) ?? []
  );
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
  return { account, credentialProjects, credentials };
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

function AccountSidebar({
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
  const [credentialProjectId, setCredentialProjectId] = useState('');
  const [credentialKind, setCredentialKind] = useState<'api_key' | 'mcp_token'>('api_key');
  const [credentialName, setCredentialName] = useState('');
  const [credentialExpiry, setCredentialExpiry] = useState('never');
  const [credentialPermissions, setCredentialPermissions] = useState(defaultCredentialPermissions);
  const [createdToken, setCreatedToken] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<ApiCredential>();
  const queryClient = useQueryClient();

  const { account, credentialProjects, credentials } = useAccountQueries(activePage);

  useEffect(() => {
    if (!credentialProjectId && credentialProjects.data?.[0]) {
      setCredentialProjectId(credentialProjects.data[0].id);
    }
  }, [credentialProjectId, credentialProjects.data]);
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
  const createCredential = useMutation({
    mutationFn: () =>
      api<ApiCredential & { token: string }>('/api/v1/account/credentials', {
        method: 'POST',
        body: JSON.stringify({
          projectId: credentialProjectId,
          kind: credentialKind,
          name: credentialName.trim(),
          permissions: credentialPermissions,
          expiresAt: credentialExpiration(credentialExpiry),
        }),
      }),
    onSuccess: (credential) => {
      setCreatedToken(credential.token);
      setCredentialName('');
      void queryClient.invalidateQueries({ queryKey: ['api-credentials'] });
    },
  });
  const revokeCredential = useMutation({
    mutationFn: (credentialId: string) =>
      api<ApiCredential>(`/api/v1/account/credentials/${credentialId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRevokeTarget(undefined);
      void queryClient.invalidateQueries({ queryKey: ['api-credentials'] });
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
  const submitCredential = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createCredential.reset();
    if (!credentialProjectId || !credentialName.trim() || !credentialPermissions.length) return;
    createCredential.mutate();
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
  const chooseCredentialProject = (projectId: string) => {
    setCredentialProjectId(projectId);
    const permissions = permissionsForProject(credentialProjects.data, projectId);
    setCredentialPermissions(permissions.includes('read_project') ? ['read_project'] : []);
  };
  const availableCredentialPermissions = permissionsForProject(
    credentialProjects.data,
    credentialProjectId,
  );
  const busy = anyPending(
    account.isLoading,
    ...[updateProfile, updatePreferences, changePassword, createCredential, revokeCredential].map(
      (mutation) => mutation.isPending,
    ),
  );

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
          ) : activePage === 'profile' ? (
            <ProfileSection
              fields={profileFields}
              mutation={updateProfile}
              onSubmit={submitProfile}
              onFieldChange={updateProfileField}
            />
          ) : activePage === 'preferences' ? (
            <PreferencesSection
              preferences={preferences}
              mutation={updatePreferences}
              onSubmit={submitPreferences}
              onChange={updatePreference}
            />
          ) : activePage === 'security' ? (
            <SecurityPage
              fields={passwordFields}
              validation={passwordValidation}
              mutation={changePassword}
              onSubmit={submitPassword}
              onFieldChange={updatePasswordField}
            />
          ) : (
            <DeveloperSection
              projectId={credentialProjectId}
              kind={credentialKind}
              name={credentialName}
              expiry={credentialExpiry}
              permissions={credentialPermissions}
              availablePermissions={availableCredentialPermissions}
              projects={credentialProjects.data ?? []}
              projectsLoading={credentialProjects.isLoading}
              credentials={credentials.data ?? []}
              credentialsLoading={credentials.isLoading}
              createdToken={createdToken}
              createMutation={createCredential}
              onSubmit={submitCredential}
              onProjectChange={chooseCredentialProject}
              onKindChange={setCredentialKind}
              onNameChange={setCredentialName}
              onExpiryChange={setCredentialExpiry}
              onPermissionsChange={setCredentialPermissions}
              onRevoke={setRevokeTarget}
            />
          )}
        </div>
      </div>
      {revokeTarget && (
        <RevokeCredentialDialog
          target={revokeTarget}
          busy={revokeCredential.isPending}
          error={revokeCredential.error}
          onCancel={() => setRevokeTarget(undefined)}
          onConfirm={() => revokeCredential.mutate(revokeTarget.id)}
        />
      )}
    </main>
  );
}
