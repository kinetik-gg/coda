import { PASSWORD_MIN_LENGTH, type AccountPreferences, type Permission } from '@coda/contracts';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type { FormEventHandler } from 'react';
import { ApiError } from '../api';
import { fontSizeOptions } from '../account-preferences';
import { CustomSelect } from '../components/CustomSelect';
import { Skeleton, SkeletonGroup } from '../components/Skeleton';
import { themes } from '../themes';
import type { PasswordFields } from '../account-validation';
import styles from '../AccountScreen.module.css';
import type { ApiCredential, CredentialProject, MutationFeedback, ProfileFields } from './types';

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

export function AccountLoadingSkeleton() {
  return (
    <SkeletonGroup label="Loading account details" className={styles.formPanel}>
      <div className={styles.formHeading}>
        <Skeleton width={112} height={14} />
        <Skeleton width={260} height={9} />
      </div>
      <div className={styles.formGrid}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={styles.field} key={index}>
            <Skeleton width={index % 2 ? 74 : 96} height={9} />
            <Skeleton width="100%" height={34} radius={4} />
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <Skeleton width={102} height={30} radius={4} />
      </div>
    </SkeletonGroup>
  );
}

export function AccountLoadError({ retry }: { retry: () => void }) {
  return (
    <section className={styles.emptyState} role="alert">
      <WarningCircleIcon size={20} aria-hidden="true" />
      <h2>Account details could not be loaded.</h2>
      <p>Check the service connection, then try again.</p>
      <button type="button" className={styles.secondaryButton} onClick={retry}>
        Try again
      </button>
    </section>
  );
}

interface ProfileSectionProps {
  fields: ProfileFields;
  mutation: MutationFeedback;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onFieldChange: (field: keyof ProfileFields, value: string) => void;
}

export function ProfileSection({ fields, mutation, onSubmit, onFieldChange }: ProfileSectionProps) {
  return (
    <form className={styles.formPanel} onSubmit={onSubmit}>
      <div className={styles.formHeading}>
        <h2>Profile information</h2>
        <p>Required details identify you to other members. Organization fields are optional.</p>
      </div>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>
            Display name <b aria-hidden="true">*</b>
          </span>
          <input
            type="text"
            autoComplete="name"
            required
            value={fields.displayName}
            onChange={(event) => onFieldChange('displayName', event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>
            Email address <b aria-hidden="true">*</b>
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={fields.email}
            onChange={(event) => onFieldChange('email', event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>
            Company <small>Optional</small>
          </span>
          <input
            type="text"
            autoComplete="organization"
            value={fields.company}
            onChange={(event) => onFieldChange('company', event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>
            Department <small>Optional</small>
          </span>
          <input
            type="text"
            autoComplete="organization-title"
            value={fields.department}
            onChange={(event) => onFieldChange('department', event.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <div className={styles.formFeedback} aria-live="polite">
          {mutation.isSuccess && (
            <span className={styles.success}>
              <CheckCircleIcon size={12} weight="fill" aria-hidden="true" /> Profile saved.
            </span>
          )}
          {mutation.error && (
            <span className={styles.error} role="alert">
              <WarningCircleIcon size={12} aria-hidden="true" />{' '}
              {errorMessage(mutation.error, 'Profile could not be saved.')}
            </span>
          )}
        </div>
        <button className={styles.primaryButton} type="submit" disabled={mutation.isPending}>
          <FloppyDiskIcon size={12} aria-hidden="true" />
          {mutation.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}

interface PreferencesSectionProps {
  preferences: AccountPreferences;
  mutation: MutationFeedback;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onChange: <Key extends keyof AccountPreferences>(
    key: Key,
    value: AccountPreferences[Key],
  ) => void;
}

export function PreferencesSection({
  preferences,
  mutation,
  onSubmit,
  onChange,
}: PreferencesSectionProps) {
  return (
    <form className={styles.formPanel} onSubmit={onSubmit}>
      <div className={styles.formHeading}>
        <h2>Interface preferences</h2>
        <p>These choices follow your account across browsers and signed-in devices.</p>
      </div>
      <div className={styles.preferenceList}>
        <label className={styles.preferenceRow}>
          <span>
            <strong>Theme</strong>
            <small>Choose the color palette used throughout Coda.</small>
          </span>
          <CustomSelect
            value={preferences.theme}
            onChange={(value) => onChange('theme', value as AccountPreferences['theme'])}
            options={themes.map((theme) => ({ value: theme.id, label: theme.label }))}
            ariaLabel="Interface theme"
          />
        </label>
        <label className={styles.preferenceRow}>
          <span>
            <strong>Font size</strong>
            <small>Scale text in dense workspace panels without changing browser zoom.</small>
          </span>
          <CustomSelect
            value={preferences.fontSize}
            onChange={(value) => onChange('fontSize', value as AccountPreferences['fontSize'])}
            options={[...fontSizeOptions]}
            ariaLabel="Workspace font size"
          />
        </label>
        <label className={styles.preferenceRow}>
          <span>
            <strong>Motion</strong>
            <small>Follow the operating system or reduce interface animation.</small>
          </span>
          <CustomSelect
            value={preferences.motion}
            onChange={(value) => onChange('motion', value as AccountPreferences['motion'])}
            options={[
              { value: 'system', label: 'Follow system' },
              { value: 'reduced', label: 'Reduce motion' },
            ]}
            ariaLabel="Interface motion"
          />
        </label>
        <label className={styles.preferenceRow}>
          <span>
            <strong>PDF appearance</strong>
            <small>Set the default document colors when a panel has no override.</small>
          </span>
          <CustomSelect
            value={preferences.pdfAppearance}
            onChange={(value) =>
              onChange('pdfAppearance', value as AccountPreferences['pdfAppearance'])
            }
            options={[
              { value: 'theme', label: 'Follow theme' },
              { value: 'light', label: 'Light document' },
              { value: 'dark', label: 'Dark document' },
            ]}
            ariaLabel="Default PDF appearance"
          />
        </label>
      </div>
      <div className={styles.actions}>
        <div className={styles.formFeedback} aria-live="polite">
          {mutation.isSuccess && (
            <span className={styles.success}>
              <CheckCircleIcon size={12} weight="fill" aria-hidden="true" /> Preferences saved.
            </span>
          )}
          {mutation.error && (
            <span className={styles.error} role="alert">
              <WarningCircleIcon size={12} aria-hidden="true" />{' '}
              {errorMessage(mutation.error, 'Preferences could not be saved.')}
            </span>
          )}
        </div>
        <button className={styles.primaryButton} type="submit" disabled={mutation.isPending}>
          <FloppyDiskIcon size={12} aria-hidden="true" />
          {mutation.isPending ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </form>
  );
}

interface SecuritySectionProps {
  fields: PasswordFields;
  validation: string | null;
  mutation: MutationFeedback;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onFieldChange: (field: keyof PasswordFields, value: string) => void;
}

export function SecuritySection({
  fields,
  validation,
  mutation,
  onSubmit,
  onFieldChange,
}: SecuritySectionProps) {
  return (
    <form className={styles.formPanel} onSubmit={onSubmit} noValidate>
      <div className={styles.formHeading}>
        <h2>Change password</h2>
        <p>Confirm your current password before choosing a replacement.</p>
      </div>
      <div className={styles.formGridSingle}>
        <label className={styles.field}>
          <span>
            Current password <b aria-hidden="true">*</b>
          </span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={fields.currentPassword}
            onChange={(event) => onFieldChange('currentPassword', event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>
            New password <b aria-hidden="true">*</b>
          </span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={fields.newPassword}
            onChange={(event) => onFieldChange('newPassword', event.target.value)}
          />
          <small>
            Use at least {PASSWORD_MIN_LENGTH} characters. Avoid common or previously leaked
            passwords.
          </small>
        </label>
        <label className={styles.field}>
          <span>
            Confirm new password <b aria-hidden="true">*</b>
          </span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? 'password-form-error' : undefined}
            value={fields.confirmPassword}
            onChange={(event) => onFieldChange('confirmPassword', event.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <div className={styles.formFeedback} aria-live="polite">
          {mutation.isSuccess && (
            <span className={styles.success}>
              <CheckCircleIcon size={12} weight="fill" aria-hidden="true" /> Password changed.
            </span>
          )}
          {validation && (
            <span id="password-form-error" className={styles.error} role="alert">
              <WarningCircleIcon size={12} aria-hidden="true" /> {validation}
            </span>
          )}
          {mutation.error && (
            <span className={styles.error} role="alert">
              <WarningCircleIcon size={12} aria-hidden="true" />{' '}
              {errorMessage(mutation.error, 'Password could not be changed.')}
            </span>
          )}
        </div>
        <button className={styles.primaryButton} type="submit" disabled={mutation.isPending}>
          <LockKeyIcon size={12} aria-hidden="true" />
          {mutation.isPending ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

interface DeveloperSectionProps {
  projectId: string;
  kind: 'api_key' | 'mcp_token';
  name: string;
  expiry: string;
  permissions: Permission[];
  availablePermissions: Permission[];
  projects: CredentialProject[];
  projectsLoading: boolean;
  credentials: ApiCredential[];
  credentialsLoading: boolean;
  createdToken: string;
  createMutation: MutationFeedback;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onProjectChange: (projectId: string) => void;
  onKindChange: (kind: 'api_key' | 'mcp_token') => void;
  onNameChange: (name: string) => void;
  onExpiryChange: (expiry: string) => void;
  onPermissionsChange: (permissions: Permission[]) => void;
  onRevoke: (credential: ApiCredential) => void;
}

export function DeveloperSection(props: DeveloperSectionProps) {
  return (
    <div className={styles.developerStack}>
      <form className={styles.formPanel} onSubmit={props.onSubmit}>
        <div className={styles.formHeading}>
          <h2>Create a credential</h2>
          <p>Credentials inherit only the breakdown permissions you explicitly select.</p>
        </div>
        <div className={styles.credentialForm}>
          <label className={styles.field}>
            <span>Breakdown</span>
            <CustomSelect
              ariaLabel="Credential breakdown"
              value={props.projectId}
              options={props.projects.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
              disabled={props.projectsLoading}
              onChange={props.onProjectChange}
            />
          </label>
          <label className={styles.field}>
            <span>Type</span>
            <CustomSelect
              ariaLabel="Credential type"
              value={props.kind}
              options={[
                { value: 'api_key', label: 'REST API key' },
                { value: 'mcp_token', label: 'MCP token' },
              ]}
              onChange={(value) => props.onKindChange(value as DeveloperSectionProps['kind'])}
            />
          </label>
          <label className={styles.field}>
            <span>Name</span>
            <input
              required
              maxLength={120}
              value={props.name}
              placeholder="Development integration"
              onChange={(event) => props.onNameChange(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Expires</span>
            <CustomSelect
              ariaLabel="Credential expiry"
              value={props.expiry}
              options={[
                { value: 'never', label: 'Never' },
                { value: '24h', label: '24 hours' },
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
              ]}
              onChange={props.onExpiryChange}
            />
          </label>
        </div>
        <fieldset className={styles.permissionGrid}>
          <legend>Permissions</legend>
          {props.availablePermissions.map((permission) => (
            <label key={permission}>
              <input
                type="checkbox"
                checked={props.permissions.includes(permission)}
                onChange={(event) =>
                  props.onPermissionsChange(
                    event.target.checked
                      ? [...props.permissions, permission]
                      : props.permissions.filter((value) => value !== permission),
                  )
                }
              />
              <span>{permission.replaceAll('_', ' ').replaceAll('project', 'breakdown')}</span>
            </label>
          ))}
        </fieldset>
        {props.createdToken && (
          <div className={styles.tokenReveal} role="status">
            <div>
              <strong>Copy this token now</strong>
              <span>It will not be shown again.</span>
            </div>
            <code>{props.createdToken}</code>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void navigator.clipboard.writeText(props.createdToken)}
            >
              <CopyIcon size={12} aria-hidden="true" /> Copy token
            </button>
          </div>
        )}
        <div className={styles.actions}>
          <div className={styles.formFeedback} aria-live="polite">
            {props.createMutation.error && (
              <span className={styles.error} role="alert">
                <WarningCircleIcon size={12} aria-hidden="true" />{' '}
                {errorMessage(props.createMutation.error, 'Credential could not be created.')}
              </span>
            )}
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={
              props.createMutation.isPending ||
              !props.projectId ||
              !props.name.trim() ||
              !props.permissions.length
            }
          >
            <KeyIcon size={12} aria-hidden="true" />
            {props.createMutation.isPending ? 'Creating…' : 'Create credential'}
          </button>
        </div>
      </form>
      <section className={styles.formPanel}>
        <div className={styles.formHeading}>
          <h2>Credentials</h2>
          <p>Revoke credentials that are no longer used.</p>
        </div>
        <div className={styles.credentialList}>
          {props.credentials.map((credential) => (
            <article key={credential.id} data-revoked={Boolean(credential.revokedAt)}>
              <div>
                <strong>{credential.name}</strong>
                <span>
                  {credential.kind === 'API_KEY' ? 'REST API' : 'MCP'} · {credential.project.name}
                </span>
              </div>
              <code>
                {credential.tokenPrefix}…{credential.tokenLastFour}
              </code>
              <span>
                {credential.revokedAt
                  ? 'Revoked'
                  : credential.expiresAt
                    ? `Expires ${new Date(credential.expiresAt).toLocaleDateString()}`
                    : 'No expiry'}
              </span>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={Boolean(credential.revokedAt)}
                onClick={() => props.onRevoke(credential)}
              >
                <TrashIcon size={12} aria-hidden="true" /> Revoke
              </button>
            </article>
          ))}
          {!props.credentialsLoading && !props.credentials.length && (
            <p className={styles.credentialEmpty}>No credentials have been created.</p>
          )}
        </div>
      </section>
    </div>
  );
}

export { errorMessage as accountErrorMessage };
