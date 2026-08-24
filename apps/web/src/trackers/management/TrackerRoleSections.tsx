import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { allTrackerPermissions, type TrackerPermission } from '@coda/contracts';
import { updateTrackerRole } from '../../api';
import { ShareSection } from './TrackerManagementSections';
import type { ManagedTrackerRole } from './types';
import type { TrackerManagementController } from './useTrackerManagement';
import styles from './TrackerManagement.module.css';

export const trackerPermissionLabels: Record<TrackerPermission, string> = {
  read_tracker: 'Read tracker',
  edit_tracker_records: 'Edit records',
  manage_tracker_fields: 'Manage fields',
  manage_tracker_settings: 'Manage settings',
  invite_members: 'Invite members',
  manage_member_roles: 'Manage member roles',
  manage_roles: 'Manage roles',
};

function PermissionGrid({
  selected,
  actorPermissions,
  readOnly,
  onToggle,
}: {
  selected: TrackerPermission[];
  actorPermissions: TrackerPermission[];
  readOnly: boolean;
  onToggle: (permission: TrackerPermission, checked: boolean) => void;
}) {
  return (
    <fieldset className={styles.permissionGrid} disabled={readOnly}>
      <legend>Permissions</legend>
      {allTrackerPermissions.map((permission) => (
        <label key={permission}>
          <input
            type="checkbox"
            checked={selected.includes(permission)}
            // The subset rule lives here too: a caller can never grant what they do not hold.
            disabled={!actorPermissions.includes(permission)}
            onChange={(event) => onToggle(permission, event.target.checked)}
          />
          <span>{trackerPermissionLabels[permission]}</span>
        </label>
      ))}
    </fieldset>
  );
}

function toggle(selected: TrackerPermission[], permission: TrackerPermission, checked: boolean) {
  return checked
    ? [...selected, permission]
    : selected.filter((entry) => entry !== permission);
}

/**
 * One editable custom role. Mirrors the breakdown role editor: local draft state reset on prop
 * change, save enabled only when dirty, and the permission set locked read-only when the role
 * holds grants the caller does not (#381).
 */
function TrackerRoleEditor({
  controller,
  role,
}: {
  controller: TrackerManagementController;
  role: ManagedTrackerRole;
}) {
  const { trackerId, permissions: actorPermissions, canManageRoles } = controller;
  const queryClient = useQueryClient();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [selected, setSelected] = useState<TrackerPermission[]>(
    role.permissions.map((entry) => entry.permission),
  );
  useEffect(() => {
    setName(role.name);
    setDescription(role.description ?? '');
    setSelected(role.permissions.map((entry) => entry.permission));
  }, [role]);

  const original = role.permissions.map((entry) => entry.permission);
  const permissionsDirty =
    selected.length !== original.length || selected.some((permission) => !original.includes(permission));
  const holdsElevatedGrants = original.some((permission) => !actorPermissions.includes(permission));
  const update = useMutation({
    mutationFn: () =>
      updateTrackerRole({
        trackerId,
        roleId: role.id,
        name,
        description: description || null,
        ...(permissionsDirty ? { permissions: selected } : {}),
        version: role.version,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['tracker-management', trackerId] }),
  });
  const memberCount = role._count.memberships;
  const editable = canManageRoles && !role.isOwner;

  return (
    <details className={styles.roleEditor}>
      <summary>
        <span>
          <strong>{role.name}</strong>
          {role.isOwner && <small>Owner role</small>}
        </span>
        <span>{memberCount} members</span>
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
            disabled={!editable}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <input
            maxLength={500}
            value={description}
            disabled={!editable}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <PermissionGrid
          selected={selected}
          actorPermissions={actorPermissions}
          readOnly={!editable || holdsElevatedGrants}
          onToggle={(permission, checked) => setSelected(toggle(selected, permission, checked))}
        />
        {holdsElevatedGrants && !role.isOwner && (
          <p className={styles.inlineHelp}>
            This role holds permissions you do not have, so its permission set is read-only.
          </p>
        )}
        {editable && (
          <div className={styles.formActions}>
            <button
              className={styles.secondaryButton}
              type="submit"
              disabled={
                !(
                  (name !== role.name ||
                    description !== (role.description ?? '') ||
                    permissionsDirty) &&
                  selected.length > 0 &&
                  !update.isPending
                )
              }
            >
              <FloppyDiskIcon size={12} aria-hidden="true" />
              {update.isPending ? 'Saving…' : 'Save role'}
            </button>
            <button
              className={styles.iconTextButton}
              type="button"
              disabled={memberCount > 0}
              onClick={() => controller.setRoleToArchive(role)}
            >
              <TrashIcon size={12} aria-hidden="true" /> Archive role…
            </button>
          </div>
        )}
        {memberCount > 0 && !role.isOwner && (
          <p className={styles.inlineHelp}>Reassign this role’s members before archiving it.</p>
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

/** Roles over the tracker vocabulary: seeded owner profile plus every custom role (#371). */
export function TrackerRolesSection({ controller }: { controller: TrackerManagementController }) {
  const {
    tracker,
    canManageRoles,
    permissions: actorPermissions,
    newRoleName,
    setNewRoleName,
    newRoleDescription,
    setNewRoleDescription,
    newRolePermissions,
    setNewRolePermissions,
    createRole,
  } = controller;
  return (
    <ShareSection
      label="Roles"
      note="Reusable access profiles assigned to members. A role can never grant more than you hold."
      count={tracker.roles.length}
    >
      <div className={styles.roleList}>
        {tracker.roles.map((role) => (
          <TrackerRoleEditor key={role.id} controller={controller} role={role} />
        ))}
      </div>
      {canManageRoles && (
        <details className={styles.createRole}>
          <summary>
            <PlusIcon size={12} aria-hidden="true" /> Create role
          </summary>
          <form
            className={styles.roleForm}
            onSubmit={(event) => {
              event.preventDefault();
              createRole.mutate();
            }}
          >
            <label className={styles.field}>
              <span>Role name</span>
              <input
                required
                maxLength={80}
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Description</span>
              <input
                maxLength={500}
                value={newRoleDescription}
                onChange={(event) => setNewRoleDescription(event.target.value)}
              />
            </label>
            <PermissionGrid
              selected={newRolePermissions}
              actorPermissions={actorPermissions}
              readOnly={false}
              onToggle={(permission, checked) =>
                setNewRolePermissions(toggle(newRolePermissions, permission, checked))
              }
            />
            <button
              className={styles.secondaryButton}
              type="submit"
              disabled={!newRoleName.trim() || !newRolePermissions.length || createRole.isPending}
            >
              <PlusIcon size={12} aria-hidden="true" />
              {createRole.isPending ? 'Creating…' : 'Create role'}
            </button>
            {createRole.error && (
              <p className={styles.error} role="alert">
                {createRole.error.message}
              </p>
            )}
          </form>
        </details>
      )}
    </ShareSection>
  );
}
