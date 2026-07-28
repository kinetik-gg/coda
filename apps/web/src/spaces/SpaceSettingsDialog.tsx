import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UserMinusIcon } from '@phosphor-icons/react/dist/csr/UserMinus';
import { WarningOctagonIcon } from '@phosphor-icons/react/dist/csr/WarningOctagon';
import { allSpacePermissions, type ResourceTier, type SpacePermission } from '@coda/contracts';
import { api, ApiError } from '../api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { CustomSelect } from '../components/CustomSelect';
import { ModalShell, modalButtonStyles } from '../components/ModalShell';
import styles from '../ProjectManagementScreen.styles';

const EXPOSURE_CONFIRMATION_THRESHOLD = 10;

type SectionId = 'details' | 'members' | 'roles' | 'invitations' | 'danger';

interface SpaceRole {
  id: string;
  name: string;
  description: string | null;
  isOwner: boolean;
  version: number;
  resourceTier: ResourceTier;
  permissions: Array<{ permission: SpacePermission }>;
  _count: { memberships: number };
}

interface SpaceMembership {
  id: string;
  version: number;
  user: { id: string; displayName: string; email: string } | null;
  role: SpaceRole;
}

interface ManagedSpace {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string | null;
  isDefault: boolean;
  version: number;
  roles: SpaceRole[];
  memberships: SpaceMembership[];
  invitations: Array<{
    id: string;
    email: string;
    expiresAt: string;
    role: { id: string; name: string };
    inviter: { displayName: string } | null;
  }>;
  currentMembership: { id: string; roleId: string; permissions: SpacePermission[] } | null;
  _count: { resources: number };
}

interface AvailableUser {
  id: string;
  displayName: string;
  email: string;
}

const permissionLabels: Record<SpacePermission, string> = {
  read_space: 'View Space',
  manage_space_settings: 'Manage settings',
  invite_members: 'Invite members',
  manage_member_roles: 'Manage member roles',
  manage_roles: 'Manage roles',
  create_resources: 'Create resources',
  move_resources: 'Move resources',
  delete_space: 'Delete Space',
};

function spacePermission(space: ManagedSpace, permission: SpacePermission): boolean {
  return space.currentMembership?.permissions.includes(permission) === true;
}

function useSpaceInvalidation(spaceId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['space-management', spaceId] }),
      queryClient.invalidateQueries({ queryKey: ['space-available-users', spaceId] }),
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
    ]);
  };
}

function SpaceSettingsNavigation({
  section,
  onSelect,
}: {
  section: SectionId;
  onSelect: (section: SectionId) => void;
}) {
  const items: Array<{ id: SectionId; label: string }> = [
    { id: 'details', label: 'Details' },
    { id: 'members', label: 'Members' },
    { id: 'roles', label: 'Roles' },
    { id: 'invitations', label: 'Invitations' },
    { id: 'danger', label: 'Danger' },
  ];
  return (
    <nav className={styles.sidebarNav} aria-label="Space settings sections">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={styles.sidebarButton}
          aria-current={section === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          <WarningOctagonIcon size={12} aria-hidden />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function DetailsSection({ space }: { space: ManagedSpace }) {
  const invalidate = useSpaceInvalidation(space.id);
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description ?? '');
  useEffect(() => {
    setName(space.name);
    setDescription(space.description ?? '');
  }, [space]);
  const save = useMutation({
    mutationFn: () =>
      api<ManagedSpace>(`/api/v1/spaces/${space.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          version: space.version,
        }),
      }),
    onSuccess: invalidate,
  });
  const changed = name.trim() !== space.name || (description.trim() || null) !== space.description;
  const conflict = save.error instanceof ApiError && save.error.problem.status === 409;
  return (
    <section aria-labelledby="space-settings-details-title">
      <header className={styles.pageIntro}>
        <h1 id="space-settings-details-title">Details</h1>
        <p>Update the name and description that identify this Space across Coda.</p>
      </header>
      <form
        className={styles.detailsForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && name.trim()) save.mutate();
        }}
      >
        <label className={styles.field}>
          <span>Name</span>
          <input
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <textarea
            rows={5}
            maxLength={4000}
            value={description}
            placeholder="Describe this Space’s purpose."
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!changed || !name.trim() || save.isPending}
          >
            <FloppyDiskIcon size={12} aria-hidden /> {save.isPending ? 'Saving…' : 'Save details'}
          </button>
        </div>
        {save.error && (
          <p className={styles.error} role="alert">
            {conflict
              ? 'This Space changed elsewhere. Your changes have not been lost; refresh the details and retry.'
              : save.error.message}
          </p>
        )}
      </form>
    </section>
  );
}

function ExposureConfirmation({
  space,
  onCancel,
  onConfirm,
}: {
  space: ManagedSpace;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  return (
    <ModalShell
      config={{
        regions: {
          header: { title: 'Confirm Space-wide access' },
          body: {
            description: (
              <p>
                This gives the new member access to all <strong>{space._count.resources}</strong>{' '}
                resources in <strong>{space.name}</strong>. Create a new Space and move only the
                relevant resources into it before sharing when this scope is broader than intended.
              </p>
            ),
            content: (
              <label className={styles.field}>
                <span>Type {space.name} to confirm</span>
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoFocus
                />
              </label>
            ),
          },
          footer: (
            <>
              <button type="button" className={modalButtonStyles.secondary} onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className={modalButtonStyles.primary}
                disabled={confirmation !== space.name}
                onClick={onConfirm}
              >
                Add member
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onCancel },
      }}
    />
  );
}

function MembersSection({ space }: { space: ManagedSpace }) {
  const invalidate = useSpaceInvalidation(space.id);
  const canInvite = spacePermission(space, 'invite_members');
  const canManageRoles = spacePermission(space, 'manage_member_roles');
  const users = useQuery({
    queryKey: ['space-available-users', space.id],
    queryFn: () => api<AvailableUser[]>(`/api/v1/spaces/${space.id}/available-users`),
    enabled: canInvite,
  });
  const assignableRoles = useMemo(() => space.roles.filter((role) => !role.isOwner), [space.roles]);
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [confirmingExposure, setConfirmingExposure] = useState(false);
  useEffect(() => {
    setUserId((current) =>
      users.data?.some((user) => user.id === current) ? current : (users.data?.[0]?.id ?? ''),
    );
    setRoleId((current) =>
      assignableRoles.some((role) => role.id === current)
        ? current
        : (assignableRoles[0]?.id ?? ''),
    );
  }, [assignableRoles, users.data]);
  const addMember = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${space.id}/memberships`, {
        method: 'POST',
        body: JSON.stringify({ userId, roleId }),
      }),
    onSuccess: async () => {
      setConfirmingExposure(false);
      await invalidate();
    },
  });
  const changeRole = useMutation({
    mutationFn: ({ membership, nextRoleId }: { membership: SpaceMembership; nextRoleId: string }) =>
      api(`/api/v1/spaces/${space.id}/memberships/${membership.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleId: nextRoleId, version: membership.version }),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (membership: SpaceMembership) =>
      api(`/api/v1/spaces/${space.id}/memberships/${membership.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: membership.version }),
      }),
    onSuccess: invalidate,
  });
  const submit = () => {
    if (space._count.resources > EXPOSURE_CONFIRMATION_THRESHOLD) setConfirmingExposure(true);
    else addMember.mutate();
  };
  return (
    <>
      <section aria-labelledby="space-settings-members-title">
        <header className={styles.pageIntro}>
          <h1 id="space-settings-members-title">Members</h1>
          <p>Every member receives their role’s access to every resource in this Space.</p>
        </header>
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Members</h2>
              <p>{space._count.resources} resources will be exposed to each added member.</p>
            </div>
            <span className={styles.countBadge}>{space.memberships.length}</span>
          </div>
          {canInvite && (
            <form
              className={styles.addMemberForm}
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label className={styles.field}>
                <span>Registered user</span>
                <CustomSelect
                  ariaLabel="Registered user"
                  value={userId}
                  disabled={users.isLoading || !users.data?.length}
                  onChange={setUserId}
                  placeholder="No users available"
                  options={(users.data ?? []).map((user) => ({
                    value: user.id,
                    label: `${user.displayName} — ${user.email}`,
                  }))}
                />
              </label>
              <label className={styles.field}>
                <span>Space role</span>
                <CustomSelect
                  ariaLabel="Space role"
                  value={roleId}
                  onChange={setRoleId}
                  options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
                />
              </label>
              <button
                className={styles.secondaryButton}
                type="submit"
                disabled={!userId || !roleId || addMember.isPending}
              >
                <PlusIcon size={12} aria-hidden /> {addMember.isPending ? 'Adding…' : 'Add member'}
              </button>
            </form>
          )}
          {users.error && (
            <p className={styles.error} role="alert">
              {users.error.message}
            </p>
          )}
          {addMember.error && (
            <p className={styles.error} role="alert">
              {addMember.error.message}
            </p>
          )}
          <div className={styles.memberList} role="table" aria-label="Space members">
            {space.memberships.map((membership) => {
              const owner = membership.role.isOwner;
              const user = membership.user;
              return (
                <div className={styles.memberRow} role="row" key={membership.id}>
                  <span className={styles.memberIdentity} role="cell">
                    <strong>{user?.displayName ?? 'Deleted account'}</strong>
                    <small>{user?.email ?? 'Account unavailable'}</small>
                  </span>
                  <span className={styles.memberControls} role="cell">
                    <CustomSelect
                      ariaLabel={`Role for ${user?.displayName ?? 'member'}`}
                      value={membership.role.id}
                      disabled={owner || !canManageRoles || changeRole.isPending}
                      onChange={(nextRoleId) => changeRole.mutate({ membership, nextRoleId })}
                      options={(owner ? [membership.role] : assignableRoles).map((role) => ({
                        value: role.id,
                        label: role.name,
                      }))}
                    />
                    <button
                      className={styles.iconButton}
                      type="button"
                      aria-label={`Remove ${user?.displayName ?? 'member'} from Space`}
                      disabled={owner || !canManageRoles || remove.isPending}
                      onClick={() => remove.mutate(membership)}
                    >
                      <UserMinusIcon size={12} aria-hidden />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          {(changeRole.error || remove.error) && (
            <p className={styles.error} role="alert">
              {(changeRole.error ?? remove.error)?.message}
            </p>
          )}
        </section>
      </section>
      {confirmingExposure && (
        <ExposureConfirmation
          space={space}
          onCancel={() => setConfirmingExposure(false)}
          onConfirm={() => addMember.mutate()}
        />
      )}
    </>
  );
}

function RoleEditor({
  spaceId,
  role,
  canManage,
}: {
  spaceId: string;
  role: SpaceRole;
  canManage: boolean;
}) {
  const invalidate = useSpaceInvalidation(spaceId);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [tier, setTier] = useState<ResourceTier>(role.resourceTier);
  const [permissions, setPermissions] = useState<SpacePermission[]>(
    role.permissions.map((entry) => entry.permission),
  );
  useEffect(() => {
    setName(role.name);
    setDescription(role.description ?? '');
    setTier(role.resourceTier);
    setPermissions(role.permissions.map((entry) => entry.permission));
  }, [role]);
  const update = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${spaceId}/roles/${role.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          description: description || null,
          resourceTier: tier,
          permissions,
          version: role.version,
        }),
      }),
    onSuccess: invalidate,
  });
  const changed =
    name !== role.name ||
    description !== (role.description ?? '') ||
    tier !== role.resourceTier ||
    permissions.length !== role.permissions.length ||
    permissions.some(
      (permission) => !role.permissions.some((entry) => entry.permission === permission),
    );
  return (
    <details className={styles.roleEditor}>
      <summary>
        <span>
          <strong>{role.name}</strong>
          {role.isOwner && <small>Owner role</small>}
        </span>
        <span>{role._count.memberships} members</span>
      </summary>
      <form
        className={styles.roleForm}
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate();
        }}
      >
        <label className={styles.field}>
          <span>Role name</span>
          <input
            required
            maxLength={80}
            value={name}
            disabled={!canManage || role.isOwner}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Resource access</span>
          <select
            value={tier}
            disabled={!canManage || role.isOwner}
            onChange={(event) => setTier(event.target.value as ResourceTier)}
          >
            <option value="viewer">Viewer</option>
            <option value="contributor">Contributor</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <input
            maxLength={500}
            value={description}
            disabled={!canManage || role.isOwner}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <fieldset className={styles.permissionGrid} disabled={!canManage || role.isOwner}>
          {allSpacePermissions.map((permission) => (
            <label key={permission}>
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                onChange={(event) =>
                  setPermissions((current) =>
                    event.target.checked
                      ? [...current, permission]
                      : current.filter((entry) => entry !== permission),
                  )
                }
              />
              <span>{permissionLabels[permission]}</span>
            </label>
          ))}
        </fieldset>
        {!role.isOwner && canManage && (
          <button
            type="submit"
            className={styles.secondaryButton}
            disabled={!changed || !name.trim() || !permissions.length || update.isPending}
          >
            <FloppyDiskIcon size={12} aria-hidden /> {update.isPending ? 'Saving…' : 'Save role'}
          </button>
        )}
        {update.error && (
          <p className={styles.error} role="alert">
            {update.error.message}
          </p>
        )}
      </form>
    </details>
  );
}

function RolesSection({ space }: { space: ManagedSpace }) {
  const invalidate = useSpaceInvalidation(space.id);
  const canManage = spacePermission(space, 'manage_roles');
  const [name, setName] = useState('');
  const [tier, setTier] = useState<ResourceTier>('viewer');
  const [permissions, setPermissions] = useState<SpacePermission[]>(['read_space']);
  const create = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${space.id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ name, resourceTier: tier, permissions }),
      }),
    onSuccess: async () => {
      setName('');
      setTier('viewer');
      setPermissions(['read_space']);
      await invalidate();
    },
  });
  return (
    <section aria-labelledby="space-settings-roles-title">
      <header className={styles.pageIntro}>
        <h1 id="space-settings-roles-title">Roles</h1>
        <p>Roles combine Space administration permissions with a resource access tier.</p>
      </header>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Roles and permissions</h2>
            <p>Assign reusable access profiles to Space members.</p>
          </div>
          <span className={styles.countBadge}>{space.roles.length}</span>
        </div>
        <div className={styles.roleList}>
          {space.roles.map((role) => (
            <RoleEditor key={role.id} spaceId={space.id} role={role} canManage={canManage} />
          ))}
        </div>
        {canManage && (
          <details className={styles.createRole}>
            <summary>
              <PlusIcon size={12} aria-hidden /> Create role
            </summary>
            <form
              className={styles.roleForm}
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <label className={styles.field}>
                <span>Role name</span>
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Resource access</span>
                <select
                  value={tier}
                  onChange={(event) => setTier(event.target.value as ResourceTier)}
                >
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                  <option value="manager">Manager</option>
                </select>
              </label>
              <fieldset className={styles.permissionGrid}>
                {allSpacePermissions.map((permission) => (
                  <label key={permission}>
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission)}
                      onChange={(event) =>
                        setPermissions((current) =>
                          event.target.checked
                            ? [...current, permission]
                            : current.filter((entry) => entry !== permission),
                        )
                      }
                    />
                    <span>{permissionLabels[permission]}</span>
                  </label>
                ))}
              </fieldset>
              <button
                className={styles.secondaryButton}
                type="submit"
                disabled={!name.trim() || !permissions.length || create.isPending}
              >
                <PlusIcon size={12} aria-hidden /> {create.isPending ? 'Creating…' : 'Create role'}
              </button>
              {create.error && (
                <p className={styles.error} role="alert">
                  {create.error.message}
                </p>
              )}
            </form>
          </details>
        )}
      </section>
    </section>
  );
}

function InvitationsSection({ space }: { space: ManagedSpace }) {
  const invalidate = useSpaceInvalidation(space.id);
  const canInvite = spacePermission(space, 'invite_members');
  const roles = space.roles.filter((role) => !role.isOwner);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  useEffect(
    () =>
      setRoleId((current) =>
        roles.some((role) => role.id === current) ? current : (roles[0]?.id ?? ''),
      ),
    [roles],
  );
  const invite = useMutation({
    mutationFn: () =>
      api<{ invitationUrl: string }>(`/api/v1/spaces/${space.id}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), roleId }),
      }),
    onSuccess: async () => {
      setEmail('');
      await invalidate();
    },
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      api(`/api/v1/spaces/${space.id}/invitations/${invitationId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return (
    <section aria-labelledby="space-settings-invitations-title">
      <header className={styles.pageIntro}>
        <h1 id="space-settings-invitations-title">Invitations</h1>
        <p>Invite someone by email and choose the role they receive on acceptance.</p>
      </header>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Pending invitations</h2>
            <p>Invitations grant access only when accepted.</p>
          </div>
          <span className={styles.countBadge}>{space.invitations.length}</span>
        </div>
        {canInvite && (
          <form
            className={styles.addMemberForm}
            onSubmit={(event) => {
              event.preventDefault();
              invite.mutate();
            }}
          >
            <label className={styles.field}>
              <span>Email address</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Space role</span>
              <CustomSelect
                ariaLabel="Invitation role"
                value={roleId}
                onChange={setRoleId}
                options={roles.map((role) => ({ value: role.id, label: role.name }))}
              />
            </label>
            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={!email.trim() || !roleId || invite.isPending}
            >
              <PlusIcon size={12} aria-hidden />{' '}
              {invite.isPending ? 'Inviting…' : 'Create invitation'}
            </button>
          </form>
        )}
        {invite.error && (
          <p className={styles.error} role="alert">
            {invite.error.message}
          </p>
        )}
        {invite.data && (
          <p className={styles.inlineHelp} role="status">
            Invitation created. <a href={invite.data.invitationUrl}>Open invitation link</a>
          </p>
        )}
        {space.invitations.length ? (
          <div className={styles.memberList} role="table" aria-label="Pending Space invitations">
            {space.invitations.map((invitation) => (
              <div className={styles.memberRow} role="row" key={invitation.id}>
                <span className={styles.memberIdentity} role="cell">
                  <strong>{invitation.email}</strong>
                  <small>
                    Invited by {invitation.inviter?.displayName ?? 'Unknown'} · expires{' '}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </small>
                </span>
                {canInvite && (
                  <button
                    type="button"
                    className={styles.iconTextButton}
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(invitation.id)}
                  >
                    <TrashIcon size={12} aria-hidden /> Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.inlineHelp}>No pending invitations.</p>
        )}
      </section>
    </section>
  );
}

function DangerSection({ space, onDeleted }: { space: ManagedSpace; onDeleted: () => void }) {
  const invalidate = useSpaceInvalidation(space.id);
  const [targetMembershipId, setTargetMembershipId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ownerMembership = space.memberships.find((membership) => membership.role.isOwner);
  const canTransfer = !space.isDefault && space.currentMembership?.id === ownerMembership?.id;
  const canDelete =
    !space.isDefault && space._count.resources === 0 && spacePermission(space, 'delete_space');
  const transferTargets = space.memberships.filter(
    (membership) => membership.id !== ownerMembership?.id && membership.user,
  );
  const transfer = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${space.id}/transfer-ownership`, {
        method: 'POST',
        body: JSON.stringify({ newOwnerMembershipId: targetMembershipId, version: space.version }),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/spaces/${space.id}`, { method: 'DELETE' }),
    onSuccess: onDeleted,
  });
  return (
    <>
      <section aria-labelledby="space-settings-danger-title">
        <header className={styles.pageIntro}>
          <h1 id="space-settings-danger-title">Danger</h1>
          <p>Ownership and deletion change who can control this Space and its resources.</p>
        </header>
        <section className={styles.section}>
          <div className={styles.operationRow}>
            <div>
              <h2>Transfer ownership</h2>
              <p>
                {space.isDefault
                  ? 'The Default Space has zero memberships by design, so its ownership cannot be transferred.'
                  : 'Transfer settings ownership to another active Space member.'}
              </p>
            </div>
            {canTransfer ? (
              <form
                className={styles.operationControls}
                onSubmit={(event) => {
                  event.preventDefault();
                  transfer.mutate();
                }}
              >
                <CustomSelect
                  ariaLabel="New owner"
                  value={targetMembershipId}
                  onChange={setTargetMembershipId}
                  placeholder="Select member"
                  options={transferTargets.map((membership) => ({
                    value: membership.id,
                    label: membership.user?.displayName ?? 'Deleted account',
                  }))}
                />
                <button
                  type="submit"
                  className={styles.secondaryButton}
                  disabled={!targetMembershipId || transfer.isPending}
                >
                  Transfer ownership
                </button>
              </form>
            ) : (
              <p className={styles.inlineHelp}>
                {space.isDefault
                  ? 'Disabled for the Default Space.'
                  : 'Only the current owner-role member can transfer ownership.'}
              </p>
            )}
          </div>
          {transfer.error && (
            <p className={styles.error} role="alert">
              {transfer.error.message}
            </p>
          )}
        </section>
        <section className={styles.section}>
          <div className={styles.dangerAction}>
            <div>
              <h2>Delete Space</h2>
              <p>
                {space.isDefault
                  ? 'The Default Space cannot be deleted.'
                  : space._count.resources > 0
                    ? `Move all ${space._count.resources} resources into another Space before deleting this one.`
                    : 'This permanently removes the empty Space.'}
              </p>
            </div>
            {canDelete ? (
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon size={12} aria-hidden /> Delete Space…
              </button>
            ) : (
              <p className={styles.inlineHelp}>
                {space.isDefault
                  ? 'Disabled for the Default Space.'
                  : space._count.resources > 0
                    ? 'Move resources first to enable deletion.'
                    : 'You need deletion permission to remove this Space.'}
              </p>
            )}
          </div>
        </section>
      </section>
      {confirmDelete && (
        <ConfirmationDialog
          title="Delete Space?"
          description={
            <p>
              <strong>{space.name}</strong> is empty and will be permanently removed.
            </p>
          }
          confirmLabel="Delete Space"
          busyLabel="Deleting…"
          busy={remove.isPending}
          error={remove.error?.message}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  );
}

function SpaceSettingsContent({ space, onClose }: { space: ManagedSpace; onClose: () => void }) {
  const [section, setSection] = useState<SectionId>('details');
  const content =
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
          navigation: <SpaceSettingsNavigation section={section} onSelect={setSection} />,
        },
        regions: {
          header: { title: space.name },
          body: { content },
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
  if (!management.data || management.error)
    return (
      <ModalShell
        config={{
          regions: {
            header: { title: 'Space settings' },
            body: {
              content: (
                <div className={styles.errorState}>
                  <p>
                    Space settings could not be opened. Check your access and service connection.
                  </p>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void management.refetch()}
                  >
                    Retry
                  </button>
                </div>
              ),
            },
          },
          dismissal: { onDismiss: onClose },
        }}
      />
    );
  return <SpaceSettingsContent space={management.data} onClose={onClose} />;
}
