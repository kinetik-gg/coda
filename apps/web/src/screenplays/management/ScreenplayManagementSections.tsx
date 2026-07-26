import type { ReactNode } from 'react';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { UserMinusIcon } from '@phosphor-icons/react/dist/csr/UserMinus';
import type { ScreenplayPermission } from '@coda/contracts';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { CustomSelect } from '../../components/CustomSelect';
import { Chip } from '../../content-lists';
import type { ScreenplayManagementController } from './useScreenplayManagement';
import styles from './ScreenplayManagement.module.css';

export const screenplayPermissionLabels: Record<ScreenplayPermission, string> = {
  read_screenplay: 'Read screenplay',
  edit_screenplay: 'Edit screenplay',
  invite_members: 'Invite members',
  manage_member_roles: 'Manage member roles',
  manage_roles: 'Manage roles',
  manage_screenplay_settings: 'Manage settings',
};

/**
 * One labelled band of the share modal. Flat by construction — the stacked cards these sections
 * used to render on their own route were the page idiom this issue retires (#169).
 */
function ShareSection({
  label,
  note,
  count,
  children,
}: {
  label: string;
  note?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} aria-label={label}>
      <div className={styles.sectionHeading}>
        <div>
          <h3>{label}</h3>
          {note && <p>{note}</p>}
        </div>
        {count !== undefined && <span className={styles.countBadge}>{count}</span>}
      </div>
      {children}
    </section>
  );
}

export function ScreenplayMembersSection({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const {
    screenplay,
    canInvite,
    canManageMemberRoles,
    selectedUserId,
    setSelectedUserId,
    addRoleId,
    setAddRoleId,
    assignableRoles,
    availableUsers,
    addMember,
    changeMemberRole,
    setMemberToRemove,
  } = controller;
  return (
    <ShareSection
      label="Members"
      note="Add registered users directly, or invite by email below."
      count={screenplay.memberships.length}
    >
      {canInvite && (
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault();
            addMember.mutate();
          }}
        >
          <label className={`${styles.field} ${styles.grow}`}>
            <span>Registered user</span>
            <CustomSelect
              ariaLabel="Registered user"
              value={selectedUserId}
              disabled={availableUsers.isLoading || !availableUsers.data?.length}
              onChange={setSelectedUserId}
              placeholder="No users available"
              options={(availableUsers.data ?? []).map((user) => ({
                value: user.id,
                label: `${user.displayName} — ${user.email}`,
              }))}
            />
          </label>
          <label className={styles.field}>
            <span>Role</span>
            <CustomSelect
              ariaLabel="Role for new member"
              value={addRoleId}
              onChange={setAddRoleId}
              options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
            />
          </label>
          <button
            className={styles.secondaryButton}
            type="submit"
            disabled={!selectedUserId || !addRoleId || addMember.isPending}
          >
            <PlusIcon size={12} aria-hidden="true" />
            {addMember.isPending ? 'Adding…' : 'Add member'}
          </button>
        </form>
      )}
      {addMember.error && (
        <p className={styles.error} role="alert">
          {addMember.error.message}
        </p>
      )}
      <div className={styles.rows} role="table" aria-label="Screenplay members">
        {screenplay.memberships.map((membership) => {
          const owner = membership.role?.isOwner ?? false;
          return (
            <div className={styles.row} role="row" key={membership.id}>
              <span className={styles.identity} role="cell">
                <strong>{membership.user?.displayName ?? 'Unknown user'}</strong>
                <small>{membership.user?.email}</small>
              </span>
              <span className={styles.controls} role="cell">
                {owner ? (
                  <span className={styles.ownerTag}>Owner</span>
                ) : (
                  <CustomSelect
                    className={styles.roleSelect}
                    ariaLabel={`Role for ${membership.user?.displayName ?? 'member'}`}
                    value={membership.role?.id ?? ''}
                    disabled={!canManageMemberRoles || changeMemberRole.isPending}
                    onChange={(roleId) =>
                      changeMemberRole.mutate({
                        membershipId: membership.id,
                        roleId,
                        version: membership.version,
                      })
                    }
                    options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
                  />
                )}
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label={`Remove ${membership.user?.displayName ?? 'member'}`}
                  disabled={owner || !canManageMemberRoles}
                  onClick={() => setMemberToRemove(membership)}
                >
                  <UserMinusIcon size={12} aria-hidden="true" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {changeMemberRole.error && (
        <p className={styles.error} role="alert">
          {changeMemberRole.error.message}
        </p>
      )}
    </ShareSection>
  );
}

export function ScreenplayInvitationsSection({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const {
    screenplay,
    canInvite,
    inviteEmail,
    setInviteEmail,
    inviteRoleId,
    setInviteRoleId,
    assignableRoles,
    invite,
    invitationUrl,
    setInvitationUrl,
  } = controller;
  return (
    <ShareSection
      label="Invitations"
      note="Invite someone by email; they choose a password when they accept."
      count={screenplay.invitations.length}
    >
      {canInvite && (
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (inviteEmail.trim() && inviteRoleId) invite.mutate();
          }}
        >
          <label className={`${styles.field} ${styles.grow}`}>
            <span>Email</span>
            <input
              type="email"
              required
              value={inviteEmail}
              placeholder="collaborator@example.com"
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Role</span>
            <CustomSelect
              ariaLabel="Role for invitation"
              value={inviteRoleId}
              onChange={setInviteRoleId}
              options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
            />
          </label>
          <button
            className={styles.secondaryButton}
            type="submit"
            disabled={!inviteEmail.trim() || !inviteRoleId || invite.isPending}
          >
            <PaperPlaneTiltIcon size={12} aria-hidden="true" />
            {invite.isPending ? 'Inviting…' : 'Send invitation'}
          </button>
        </form>
      )}
      {invite.error && (
        <p className={styles.error} role="alert">
          {invite.error.message}
        </p>
      )}
      {invitationUrl && (
        <div className={styles.invitationReveal} role="status">
          <strong>Invitation link created</strong>
          <div className={styles.linkRow}>
            <code>{new URL(invitationUrl, window.location.origin).toString()}</code>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(new URL(invitationUrl, window.location.origin).toString())
                  .catch(() => undefined);
              }}
            >
              Copy link
            </button>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setInvitationUrl(undefined)}
          >
            Dismiss
          </button>
        </div>
      )}
      {screenplay.invitations.length ? (
        <div className={styles.rows} role="table" aria-label="Pending invitations">
          {screenplay.invitations.map((invitation) => (
            <div className={styles.row} role="row" key={invitation.id}>
              <span className={styles.identity} role="cell">
                <strong>{invitation.email}</strong>
                <small>Invited as {invitation.role?.name ?? 'member'}</small>
              </span>
              <span className={styles.controls} role="cell">
                <Chip>PENDING</Chip>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No pending invitations.</p>
      )}
    </ShareSection>
  );
}

export function ScreenplayRolesSection({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const { screenplay } = controller;
  return (
    <ShareSection
      label="Roles"
      note="Seeded access profiles assigned to members. Custom roles are not yet available."
      count={screenplay.roles.length}
    >
      <div className={styles.rows} role="table" aria-label="Screenplay roles">
        {screenplay.roles.map((role) => (
          <div className={styles.row} role="row" key={role.id}>
            <span className={styles.identity} role="cell">
              <strong>{role.name}</strong>
              <small>
                {role.permissions
                  .map((entry) => screenplayPermissionLabels[entry.permission] ?? entry.permission)
                  .join(' · ')}
              </small>
            </span>
            <span className={styles.controls} role="cell">
              <span className={styles.ownerTag}>{role._count.memberships} members</span>
            </span>
          </div>
        ))}
      </div>
    </ShareSection>
  );
}

export function ScreenplayOwnershipSection({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const {
    isOwner,
    transferCandidates,
    transferMembershipId,
    setTransferMembershipId,
    transferOwnership,
  } = controller;
  if (!isOwner) return null;
  return (
    <ShareSection
      label="Transfer ownership"
      note="Hand this screenplay to another member. You keep access as their highest role."
    >
      <form
        className={styles.inlineForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (transferMembershipId) transferOwnership.mutate();
        }}
      >
        <label className={`${styles.field} ${styles.grow}`}>
          <span>New owner</span>
          <CustomSelect
            ariaLabel="New owner"
            value={transferMembershipId}
            disabled={!transferCandidates.length}
            placeholder={transferCandidates.length ? 'Select a member' : 'No other members'}
            onChange={setTransferMembershipId}
            options={transferCandidates.map((membership) => ({
              value: membership.id,
              label: `${membership.user?.displayName ?? 'Member'} — ${membership.user?.email ?? ''}`,
            }))}
          />
        </label>
        <button
          className={styles.dangerButton}
          type="submit"
          disabled={!transferMembershipId || transferOwnership.isPending}
        >
          {transferOwnership.isPending ? 'Transferring…' : 'Transfer ownership'}
        </button>
      </form>
      {transferOwnership.error && (
        <p className={styles.error} role="alert">
          {transferOwnership.error.message}
        </p>
      )}
    </ShareSection>
  );
}

/**
 * The share modal's destructive confirmation. Removing a member ends that person's access, so it
 * stacks a `ConfirmationDialog` over the share modal rather than acting on the click — the shell's
 * stack keeps `Escape` bound to whichever dialog is on top.
 */
export function ScreenplayManagementDialogs({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const { screenplay, memberToRemove, setMemberToRemove, removeMember } = controller;
  if (!memberToRemove) return null;
  return (
    <ConfirmationDialog
      title={`Remove ${memberToRemove.user?.displayName ?? 'member'}?`}
      description={
        <p>
          This person immediately loses access to <strong>{screenplay.title}</strong>. Their account
          is unaffected.
        </p>
      }
      confirmLabel="Remove member"
      busyLabel="Removing…"
      busy={removeMember.isPending}
      error={removeMember.error?.message}
      onCancel={() => {
        setMemberToRemove(undefined);
        removeMember.reset();
      }}
      onConfirm={() => removeMember.mutate(memberToRemove)}
    />
  );
}
