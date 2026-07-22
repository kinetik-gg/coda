import { type FormEvent } from 'react';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link';
import { CustomSelect } from '../components/CustomSelect';
import styles from '../AdminScreen.module.css';
import { ListRegion, type ManagementListQuery } from './AdminCommon';
import { InvitationRows } from './AdminRows';
import type {
  CreatedInvitation,
  InstanceInvitation,
  InvitationExpiry,
  InvitationKind,
  InvitationMembership,
  InvitationOptions,
} from './types';
import { dateTime } from './utils';

const DEFAULT_EXPIRY_CHOICES = [
  { id: 'never' as const, label: 'Never expires' },
  { id: '30_days' as const, label: '30 days' },
  { id: '7_days' as const, label: '7 days' },
  { id: '24_hours' as const, label: '24 hours' },
];

interface InvitationPageProps {
  list: ManagementListQuery;
  items: InstanceInvitation[];
  options?: InvitationOptions;
  optionsLoading: boolean;
  inviteEmail: string;
  inviteKind: InvitationKind;
  inviteExpiry: InvitationExpiry;
  inviteMembership: InvitationMembership;
  inviteProjectId: string;
  inviteRoleId: string;
  createdInvitation: CreatedInvitation | null;
  copyState: 'idle' | 'copied' | 'failed';
  pending: boolean;
  errorMessage?: string;
  onSubmit: (event: FormEvent) => void;
  onEmailChange: (value: string) => void;
  onKindChange: (value: InvitationKind) => void;
  onExpiryChange: (value: InvitationExpiry) => void;
  onMembershipChange: (value: InvitationMembership) => void;
  onProjectChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onCopy: () => Promise<void>;
  onRevoke: (item: InstanceInvitation) => void;
}

export function InvitationPage(props: InvitationPageProps) {
  const inviteProject = props.options?.projects.find(
    (project) => project.id === props.inviteProjectId,
  );
  const invalidMembership =
    props.inviteMembership === 'project' && (!props.inviteProjectId || !props.inviteRoleId);
  const invalidBulkExpiry = props.inviteKind === 'bulk' && props.inviteExpiry === 'never';

  return (
    <div className={styles.sectionStack}>
      <form className={styles.invitePanel} onSubmit={props.onSubmit}>
        <div className={styles.panelHeading}>
          <div>
            <h2>Create invitation link</h2>
            <p>Create a private email-bound link or a reusable link for multiple people.</p>
          </div>
          <LinkIcon size={16} aria-hidden="true" />
        </div>
        <div className={styles.inviteFields}>
          <label className={styles.field}>
            <span>Link type</span>
            <CustomSelect
              value={props.inviteKind}
              onChange={(value) => props.onKindChange(value as InvitationKind)}
              options={[
                { value: 'email', label: 'One email address' },
                { value: 'bulk', label: 'Reusable bulk link' },
              ]}
              ariaLabel="Invitation link type"
            />
          </label>
          {props.inviteKind === 'email' ? (
            <label className={styles.field}>
              <span>Email address</span>
              <input
                type="email"
                required
                value={props.inviteEmail}
                onChange={(event) => props.onEmailChange(event.target.value)}
                placeholder="person@example.com"
              />
            </label>
          ) : null}
          <label className={styles.field}>
            <span>Expiration</span>
            <CustomSelect
              value={props.inviteExpiry}
              onChange={(value) => props.onExpiryChange(value as InvitationExpiry)}
              options={(props.options?.expiryChoices ?? DEFAULT_EXPIRY_CHOICES)
                .filter((choice) => props.inviteKind === 'email' || choice.id !== 'never')
                .map((choice) => ({ value: choice.id, label: choice.label }))}
              ariaLabel="Invitation expiration"
            />
          </label>
          <label className={styles.field}>
            <span>Project membership</span>
            <CustomSelect
              value={props.inviteMembership}
              onChange={(value) => props.onMembershipChange(value as InvitationMembership)}
              options={[
                { value: 'none', label: 'None' },
                { value: 'project', label: 'Assign to project' },
              ]}
              ariaLabel="Project membership assignment"
            />
          </label>
          <label className={styles.field}>
            <span>Project</span>
            <CustomSelect
              value={props.inviteProjectId}
              onChange={props.onProjectChange}
              options={(props.options?.projects ?? []).map((project) => ({
                value: project.id,
                label: project.name,
                disabled: project.roles.length === 0,
              }))}
              ariaLabel="Invitation project"
              placeholder="Select project…"
              disabled={props.inviteMembership === 'none' || props.optionsLoading}
            />
          </label>
          <label className={styles.field}>
            <span>Role</span>
            <CustomSelect
              value={props.inviteRoleId}
              onChange={props.onRoleChange}
              options={(inviteProject?.roles ?? []).map((role) => ({
                value: role.id,
                label: role.name,
              }))}
              ariaLabel="Invitation project role"
              placeholder="Select role…"
              disabled={props.inviteMembership === 'none' || !props.inviteProjectId}
            />
          </label>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={props.pending || invalidBulkExpiry || invalidMembership}
          >
            {props.pending ? 'Creating…' : 'Create link'}
          </button>
        </div>
        {props.errorMessage ? (
          <p className={styles.formError} role="alert">
            {props.errorMessage}
          </p>
        ) : null}
        {props.createdInvitation ? (
          <div className={styles.linkResult} role="status">
            <div>
              <strong>Copy this link now</strong>
              <span>
                {props.createdInvitation.isReusable
                  ? 'Reusable link'
                  : props.createdInvitation.email}{' '}
                ·{' '}
                {props.createdInvitation.expiresAt
                  ? `expires ${dateTime(props.createdInvitation.expiresAt)}`
                  : 'never expires'}
              </span>
            </div>
            <code>{props.createdInvitation.url}</code>
            <button type="button" className={styles.secondaryButton} onClick={props.onCopy}>
              <CopyIcon size={12} aria-hidden="true" />
              {props.copyState === 'copied'
                ? 'Copied'
                : props.copyState === 'failed'
                  ? 'Copy failed'
                  : 'Copy link'}
            </button>
          </div>
        ) : null}
      </form>
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>Invitation history</h2>
            <p>Accepted, pending, expired, and revoked links.</p>
          </div>
        </div>
        <ListRegion
          list={props.list}
          emptyTitle="No invitations"
          emptyText="Create the first invitation link above."
          nested
        >
          <InvitationRows items={props.items} onRevoke={props.onRevoke} />
        </ListRegion>
      </section>
    </div>
  );
}
