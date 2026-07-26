import type { FormEvent } from 'react';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
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

export function ScreenplayInfoSection({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const { title, setTitle, titleDirty, updateTitle, canManageSettings } = controller;
  return (
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Screenplay information</h2>
          <p>The title shown in your library, editor, and exports.</p>
        </div>
      </div>
      <form
        className={styles.form}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (titleDirty) updateTitle.mutate();
        }}
      >
        <label className={styles.field}>
          <span>Title</span>
          <input
            required
            maxLength={160}
            value={title}
            disabled={!canManageSettings}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!canManageSettings || !titleDirty || updateTitle.isPending}
          >
            <FloppyDiskIcon size={12} aria-hidden="true" />
            {updateTitle.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {updateTitle.error && <p className={styles.formError}>{updateTitle.error.message}</p>}
      </form>
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
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Members</h2>
          <p>Add registered users directly, or invite by email below.</p>
        </div>
        <span className={styles.countBadge}>{screenplay.memberships.length}</span>
      </div>
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
      {addMember.error && <p className={styles.error}>{addMember.error.message}</p>}
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
      {changeMemberRole.error && <p className={styles.error}>{changeMemberRole.error.message}</p>}
    </section>
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
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Invitations</h2>
          <p>Invite someone by email; they choose a password when they accept.</p>
        </div>
        <span className={styles.countBadge}>{screenplay.invitations.length}</span>
      </div>
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
      {invite.error && <p className={styles.error}>{invite.error.message}</p>}
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
    </section>
  );
}

export function ScreenplayRolesSection({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const { screenplay } = controller;
  return (
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Roles</h2>
          <p>Seeded access profiles assigned to members. Custom roles are not yet available.</p>
        </div>
        <span className={styles.countBadge}>{screenplay.roles.length}</span>
      </div>
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
    </section>
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
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Transfer ownership</h2>
          <p>Hand this screenplay to another member. You keep access as their highest role.</p>
        </div>
      </div>
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
      {transferOwnership.error && <p className={styles.error}>{transferOwnership.error.message}</p>}
    </section>
  );
}

export function ScreenplayDangerSection({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const { canManageSettings, setConfirmTrash } = controller;
  return (
    <section className={`${styles.card} ${styles.dangerCard}`}>
      <div className={styles.dangerRow}>
        <div>
          <h2>Move to trash</h2>
          <p className={styles.dangerNote}>
            The screenplay stays recoverable for 30 days, then is permanently removed.
          </p>
        </div>
        <button
          className={styles.dangerButton}
          type="button"
          disabled={!canManageSettings}
          onClick={() => setConfirmTrash(true)}
        >
          <TrashIcon size={12} aria-hidden="true" /> Move to trash…
        </button>
      </div>
    </section>
  );
}

export function ScreenplayManagementDialogs({
  controller,
}: {
  controller: ScreenplayManagementController;
}) {
  const {
    screenplay,
    memberToRemove,
    setMemberToRemove,
    removeMember,
    confirmTrash,
    setConfirmTrash,
    trashScreenplay,
  } = controller;
  return (
    <>
      {memberToRemove && (
        <ConfirmationDialog
          title={`Remove ${memberToRemove.user?.displayName ?? 'member'}?`}
          description={
            <p>
              This person immediately loses access to <strong>{screenplay.title}</strong>. Their
              account is unaffected.
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
      )}
      {confirmTrash && (
        <ConfirmationDialog
          title="Move screenplay to trash?"
          description={
            <p>
              <strong>{screenplay.title}</strong> stays recoverable for 30 days, then is permanently
              removed.
            </p>
          }
          confirmLabel="Move to trash"
          busyLabel="Moving…"
          busy={trashScreenplay.isPending}
          error={trashScreenplay.error?.message}
          onCancel={() => {
            setConfirmTrash(false);
            trashScreenplay.reset();
          }}
          onConfirm={() => trashScreenplay.mutate()}
        />
      )}
    </>
  );
}
