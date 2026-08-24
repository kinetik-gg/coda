import type { ReactNode } from 'react';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { UserMinusIcon } from '@phosphor-icons/react/dist/csr/UserMinus';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { CustomSelect } from '../../components/CustomSelect';
import { Chip } from '../../content-lists';
import type { TrackerManagementController } from './useTrackerManagement';
import styles from './TrackerManagement.module.css';

/**
 * One labelled band of the share modal. Flat by construction, exactly like the screenplay share
 * modal this mirrors (#169): sections separated by a rule, not nested panels or routes (#381).
 */
export function ShareSection({
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

export function TrackerMembersSection({
  controller,
}: {
  controller: TrackerManagementController;
}) {
  const {
    tracker,
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
      count={tracker.memberships.length}
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
      {availableUsers.error && (
        <p className={styles.error} role="alert">
          {availableUsers.error.message}
        </p>
      )}
      {addMember.error && (
        <p className={styles.error} role="alert">
          {addMember.error.message}
        </p>
      )}
      <div className={styles.rows} role="table" aria-label="Tracker members">
        {tracker.memberships.map((membership) => {
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

export function TrackerInvitationsSection({
  controller,
}: {
  controller: TrackerManagementController;
}) {
  const {
    tracker,
    canInvite,
    inviteEmail,
    setInviteEmail,
    inviteRoleId,
    setInviteRoleId,
    assignableRoles,
    invite,
    invitationUrl,
    setInvitationUrl,
    setInvitationToRevoke,
    revokeInvitation,
  } = controller;
  return (
    <ShareSection
      label="Invitations"
      note="Invite someone by email; they choose a password when they accept."
      count={tracker.invitations.length}
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
              maxLength={320}
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
      {tracker.invitations.length ? (
        <div className={styles.rows} role="table" aria-label="Pending invitations">
          {tracker.invitations.map((invitation) => (
            <div className={styles.row} role="row" key={invitation.id}>
              <span className={styles.identity} role="cell">
                <strong>{invitation.email}</strong>
                <small>
                  Invited as {invitation.role?.name ?? 'member'} · expires{' '}
                  <time dateTime={invitation.expiresAt}>
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </time>
                </small>
              </span>
              <span className={styles.controls} role="cell">
                <Chip>PENDING</Chip>
                {canInvite && (
                  <button
                    className={styles.iconButton}
                    type="button"
                    aria-label={`Revoke invitation for ${invitation.email}`}
                    disabled={
                      revokeInvitation.isPending && revokeInvitation.variables?.id === invitation.id
                    }
                    onClick={() => setInvitationToRevoke(invitation)}
                  >
                    <XIcon size={12} aria-hidden="true" />
                  </button>
                )}
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

export function TrackerOwnershipSection({
  controller,
}: {
  controller: TrackerManagementController;
}) {
  const {
    isOwner,
    transferCandidates,
    transferMembershipId,
    setTransferMembershipId,
    setTransferConfirmOpen,
  } = controller;
  if (!isOwner) return null;
  return (
    <ShareSection
      label="Transfer ownership"
      note="Hand this tracker to another member. You are demoted to your lowest active role before they are promoted, so the owner role is never held twice."
    >
      <form
        className={styles.inlineForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (transferMembershipId) setTransferConfirmOpen(true);
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
          disabled={!transferMembershipId}
        >
          Transfer ownership…
        </button>
      </form>
    </ShareSection>
  );
}

/**
 * The share modal's destructive confirmations, stacked over it. The shell's dialog stack keeps
 * `Escape` bound to the topmost dialog, so cancelling one of these does not close the share modal.
 */
export function TrackerManagementDialogs({
  controller,
}: {
  controller: TrackerManagementController;
}) {
  const {
    tracker,
    memberToRemove,
    setMemberToRemove,
    removeMember,
    invitationToRevoke,
    setInvitationToRevoke,
    revokeInvitation,
    transferConfirmOpen,
    setTransferConfirmOpen,
    transferMembershipId,
    transferOwnership,
  } = controller;
  if (!memberToRemove && !invitationToRevoke && !transferConfirmOpen) return null;
  if (memberToRemove) {
    return (
      <ConfirmationDialog
        title={`Remove ${memberToRemove.user?.displayName ?? 'member'}?`}
        description={
          <p>
            This person immediately loses access to <strong>{tracker.name}</strong>. Their account
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
  if (invitationToRevoke) {
    return (
      <ConfirmationDialog
        title={`Revoke the invitation for ${invitationToRevoke.email}?`}
        description={
          <p>
            The link stops working immediately. They can be invited again at any time and nothing
            they have not accepted yet is lost.
          </p>
        }
        confirmLabel="Revoke invitation"
        busyLabel="Revoking…"
        busy={revokeInvitation.isPending}
        error={revokeInvitation.error?.message}
        onCancel={() => {
          setInvitationToRevoke(undefined);
          revokeInvitation.reset();
        }}
        onConfirm={() => revokeInvitation.mutate(invitationToRevoke)}
      />
    );
  }
  const candidate = controller.transferCandidates.find(
    (membership) => membership.id === transferMembershipId,
  );
  return (
    <ConfirmationDialog
      title={`Transfer ownership to ${candidate?.user?.displayName ?? 'this member'}?`}
      description={
        <p>
          You keep access as a regular member of <strong>{tracker.name}</strong>, demoted to your
          lowest active role before they take the owner role. Only ownership moves; fields, records,
          and members stay as they are.
        </p>
      }
      confirmLabel="Transfer ownership"
      busyLabel="Transferring…"
      busy={transferOwnership.isPending}
      error={transferOwnership.error?.message}
      onCancel={() => {
        setTransferConfirmOpen(false);
        transferOwnership.reset();
      }}
      onConfirm={() => transferOwnership.mutate()}
    />
  );
}
