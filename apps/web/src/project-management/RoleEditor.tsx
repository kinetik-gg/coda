import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { allPermissions, type Permission } from '@coda/contracts';
import { api } from '../api';
import styles from '../ProjectManagementScreen.styles';
import type { ManagedRole } from './types';

export const permissionLabels: Record<Permission, string> = {
  read_project: 'Read project',
  manage_items: 'Manage items',
  manage_entity_types: 'Manage entity types',
  manage_fields: 'Manage fields',
  manage_source_documents: 'Manage source documents',
  manage_storage_objects: 'Manage storage',
  comment: 'Comment',
  invite_members: 'Add members',
  manage_member_roles: 'Manage member roles',
  manage_roles: 'Manage roles',
  manage_project_settings: 'Manage project settings',
  delete_project: 'Delete project',
};

function RoleEditorFooter({
  role,
  canManage,
  memberCount,
  dirty,
  hasPermissions,
  pending,
  error,
  onRequestArchive,
}: {
  role: ManagedRole;
  canManage: boolean;
  memberCount: number;
  dirty: boolean;
  hasPermissions: boolean;
  pending: boolean;
  error?: Error | null;
  onRequestArchive: (role: ManagedRole) => void;
}) {
  return (
    <>
      {!role.isOwner && canManage && (
        <div className={styles.formActions}>
          <button
            className={styles.secondaryButton}
            type="submit"
            disabled={!dirty || !hasPermissions || pending}
          >
            <FloppyDiskIcon size={12} aria-hidden="true" />
            {pending ? 'Saving…' : 'Save role'}
          </button>
          <button
            className={styles.iconTextButton}
            type="button"
            disabled={memberCount > 0}
            onClick={() => onRequestArchive(role)}
          >
            <TrashIcon size={12} aria-hidden="true" /> Archive role…
          </button>
        </div>
      )}
      {memberCount > 0 && !role.isOwner && (
        <p className={styles.inlineHelp}>Reassign this role’s members before archiving it.</p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
    </>
  );
}

export function RoleEditor({
  projectId,
  role,
  canManage,
  actorPermissions,
  onRequestArchive,
}: {
  projectId: string;
  role: ManagedRole;
  canManage: boolean;
  actorPermissions: Permission[];
  onRequestArchive: (role: ManagedRole) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [permissions, setPermissions] = useState<Permission[]>(
    role.permissions?.map((entry) => entry.permission) ?? [],
  );
  useEffect(() => {
    setName(role.name);
    setDescription(role.description ?? '');
    setPermissions(role.permissions?.map((entry) => entry.permission) ?? []);
  }, [role]);

  const originalPermissions = role.permissions?.map((entry) => entry.permission) ?? [];
  const permissionDirty =
    permissions.length !== originalPermissions.length ||
    permissions.some((permission) => !originalPermissions.includes(permission));
  const hasUnavailableExisting = originalPermissions.some(
    (permission) => !actorPermissions.includes(permission),
  );
  const update = useMutation({
    mutationFn: () =>
      api(`/api/v1/projects/${projectId}/roles/${role.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          description: description || null,
          ...(permissionDirty ? { permissions } : {}),
          version: role.version ?? 1,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-management', projectId] }),
  });
  const dirty = name !== role.name || description !== (role.description ?? '') || permissionDirty;
  const memberCount = role._count?.memberships ?? 0;

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
            disabled={!canManage || Boolean(role.isOwner)}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <input
            maxLength={500}
            value={description}
            disabled={!canManage || Boolean(role.isOwner)}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <fieldset
          className={styles.permissionGrid}
          disabled={!canManage || Boolean(role.isOwner) || hasUnavailableExisting}
        >
          <legend>Permissions</legend>
          {allPermissions.map((permission) => (
            <label key={permission}>
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                disabled={!actorPermissions.includes(permission)}
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
        {hasUnavailableExisting && !role.isOwner && (
          <p className={styles.inlineHelp}>
            This role holds permissions you do not have, so its permission set is read-only.
          </p>
        )}
        <RoleEditorFooter
          role={role}
          canManage={canManage}
          memberCount={memberCount}
          dirty={dirty}
          hasPermissions={permissions.length > 0}
          pending={update.isPending}
          error={update.error}
          onRequestArchive={onRequestArchive}
        />
      </form>
    </details>
  );
}
