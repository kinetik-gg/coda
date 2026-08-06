import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { allSpacePermissions, type ResourceTier, type SpacePermission } from '@coda/contracts';
import { api, ApiError } from '../api';
import { CustomSelect } from '../components/CustomSelect';
import { ModalShell, modalButtonStyles } from '../components/ModalShell';
import styles from '../ProjectManagementScreen.styles';
import {
  EXPOSURE_CONFIRMATION_THRESHOLD,
  permissionLabels,
  spacePermission,
  type AvailableUser,
  type ManagedSpace,
} from './space-settings-model';

export function DetailsSection({ space }: { space: ManagedSpace }) {
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description ?? '');
  useEffect(() => {
    setName(space.name);
    setDescription(space.description ?? '');
  }, [space]);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${space.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          version: space.version,
        }),
      }),
  });
  const changed = name.trim() !== space.name || (description.trim() || null) !== space.description;
  const conflict = save.error instanceof ApiError && save.error.problem.status === 409;
  return (
    <section>
      <header className={styles.pageIntro}>
        <h1>Details</h1>
        <p>Update the name and description that identify this Space across Coda.</p>
      </header>
      <form
        className={styles.detailsForm}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className={styles.field}>
          <span>Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <button
          className={styles.primaryButton}
          disabled={!changed || !name.trim() || save.isPending}
        >
          <FloppyDiskIcon size={12} aria-hidden /> Save details
        </button>
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

function ConfirmExposure({
  space,
  close,
  confirm,
}: {
  space: ManagedSpace;
  close: () => void;
  confirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  return (
    <ModalShell
      config={{
        regions: {
          header: { title: 'Confirm Space-wide access' },
          body: {
            description: (
              <p>
                This gives the new member access to all <strong>{space._count.resources}</strong>{' '}
                resources in <strong>{space.name}</strong>. Create a Space, move only the relevant
                resources into it, then share that instead when this scope is too broad.
              </p>
            ),
            content: (
              <label className={styles.field}>
                <span>Type {space.name} to confirm</span>
                <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
              </label>
            ),
          },
          footer: (
            <>
              <button type="button" className={modalButtonStyles.secondary} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className={modalButtonStyles.primary}
                disabled={typed !== space.name}
                onClick={confirm}
              >
                Add member
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: close },
      }}
    />
  );
}

export function MembersSection({ space }: { space: ManagedSpace }) {
  const canInvite = spacePermission(space, 'invite_members');
  const roles = useMemo(() => space.roles.filter((role) => !role.isOwner), [space]);
  const users = useQuery({
    queryKey: ['space-available-users', space.id],
    queryFn: () => api<AvailableUser[]>(`/api/v1/spaces/${space.id}/available-users`),
    enabled: canInvite,
  });
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setUserId(users.data?.[0]?.id ?? '');
    setRoleId(roles[0]?.id ?? '');
  }, [roles, users.data]);
  const add = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${space.id}/memberships`, {
        method: 'POST',
        body: JSON.stringify({ userId, roleId }),
      }),
    onSuccess: () => setConfirming(false),
  });
  const submit = () =>
    space._count.resources > EXPOSURE_CONFIRMATION_THRESHOLD ? setConfirming(true) : add.mutate();
  return (
    <>
      <section>
        <header className={styles.pageIntro}>
          <h1>Members</h1>
          <p>Every member receives their role’s access to every resource in this Space.</p>
        </header>
        <section className={styles.section}>
          <p className={styles.inlineHelp}>
            {space._count.resources} resources will be exposed to each added member.
          </p>
          {canInvite && (
            <form
              className={styles.addMemberForm}
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <CustomSelect
                ariaLabel="Registered user"
                value={userId}
                onChange={setUserId}
                options={(users.data ?? []).map((u) => ({
                  value: u.id,
                  label: `${u.displayName} — ${u.email}`,
                }))}
              />
              <CustomSelect
                ariaLabel="Space role"
                value={roleId}
                onChange={setRoleId}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
              />
              <button
                className={styles.secondaryButton}
                disabled={!userId || !roleId || add.isPending}
              >
                <PlusIcon size={12} aria-hidden /> Add member
              </button>
            </form>
          )}
          {add.error && (
            <p className={styles.error} role="alert">
              {add.error.message}
            </p>
          )}
          <div className={styles.memberList}>
            {space.memberships.map((m) => (
              <div className={styles.memberRow} key={m.id}>
                <span className={styles.memberIdentity}>
                  <strong>{m.user?.displayName ?? 'Deleted account'}</strong>
                  <small>{m.role.name}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      </section>
      {confirming && (
        <ConfirmExposure
          space={space}
          close={() => setConfirming(false)}
          confirm={() => add.mutate()}
        />
      )}
    </>
  );
}

export function RolesSection({ space }: { space: ManagedSpace }) {
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
  });
  return (
    <section>
      <header className={styles.pageIntro}>
        <h1>Roles</h1>
        <p>Roles combine Space administration permissions with a resource access tier.</p>
      </header>
      <section className={styles.section}>
        <div className={styles.roleList}>
          {space.roles.map((r) => (
            <div className={styles.memberRow} key={r.id}>
              <strong>{r.name}</strong>
              <span>{r.resourceTier}</span>
            </div>
          ))}
        </div>
        {canManage && (
          <form
            className={styles.roleForm}
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Role name"
            />
            <select value={tier} onChange={(e) => setTier(e.target.value as ResourceTier)}>
              <option value="viewer">Viewer</option>
              <option value="contributor">Contributor</option>
              <option value="manager">Manager</option>
            </select>
            <fieldset className={styles.permissionGrid}>
              {allSpacePermissions.map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={permissions.includes(p)}
                    onChange={(e) =>
                      setPermissions((v) =>
                        e.target.checked ? [...v, p] : v.filter((x) => x !== p),
                      )
                    }
                  />
                  {permissionLabels[p]}
                </label>
              ))}
            </fieldset>
            <button className={styles.secondaryButton}>Create role</button>
          </form>
        )}
      </section>
    </section>
  );
}

export function InvitationsSection({ space }: { space: ManagedSpace }) {
  const canInvite = spacePermission(space, 'invite_members');
  const roles = space.roles.filter((r) => !r.isOwner);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const invite = useMutation({
    mutationFn: () =>
      api<{ invitationUrl: string }>(`/api/v1/spaces/${space.id}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, roleId }),
      }),
    onSuccess: () => setEmail(''),
  });
  const invitationUrl = invite.data?.invitationUrl
    ? new URL(invite.data.invitationUrl, window.location.origin).toString()
    : undefined;
  return (
    <section>
      <header className={styles.pageIntro}>
        <h1>Invitations</h1>
        <p>Invite someone by email and choose the role they receive on acceptance.</p>
      </header>
      <section className={styles.section}>
        {canInvite && (
          <form
            className={styles.addMemberForm}
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <CustomSelect
              ariaLabel="Invitation role"
              value={roleId}
              onChange={setRoleId}
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
            />
            <button
              className={styles.secondaryButton}
              disabled={!email.trim() || !roleId || invite.isPending}
            >
              {invite.isPending ? 'Creating…' : 'Create invitation'}
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
              <code>{invitationUrl}</code>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  void navigator.clipboard?.writeText(invitationUrl).catch(() => undefined);
                }}
              >
                Copy link
              </button>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => invite.reset()}>
              Dismiss
            </button>
          </div>
        )}
        {space.invitations.map((i) => (
          <p key={i.id} className={styles.inlineHelp}>
            {i.email} · {i.role.name}
          </p>
        ))}
      </section>
    </section>
  );
}
