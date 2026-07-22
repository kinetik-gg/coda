import type { FormEvent } from 'react';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { UserMinusIcon } from '@phosphor-icons/react/dist/csr/UserMinus';
import { allPermissions } from '@coda/contracts';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { CustomSelect } from '../components/CustomSelect';
import styles from '../ProjectManagementScreen.module.css';
import type { OverviewController } from './OverviewSection';
import { permissionLabels, RoleEditor } from './RoleEditor';

function ProjectInformation({ controller }: { controller: OverviewController }) {
  const {
    canManageProject,
    name,
    setName,
    description,
    setDescription,
    updateProject,
    projectDirty,
  } = controller;
  return (
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Project information</h2>
          <p>Used in project lists, selectors, and exports.</p>
        </div>
      </div>
      <form
        className={styles.formGrid}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          updateProject.mutate();
        }}
      >
        <label className={styles.field}>
          <span>Name</span>
          <input
            required
            maxLength={160}
            value={name}
            disabled={!canManageProject}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <textarea
            rows={4}
            maxLength={4000}
            value={description}
            disabled={!canManageProject}
            placeholder="Describe the purpose of this project."
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!canManageProject || !projectDirty || updateProject.isPending}
          >
            <FloppyDiskIcon size={12} aria-hidden="true" />
            {updateProject.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {updateProject.error && (
          <p className={styles.error} role="alert">
            {updateProject.error.message}
          </p>
        )}
      </form>
    </section>
  );
}

function RolesSection({ controller }: { controller: OverviewController }) {
  const {
    projectId,
    project,
    permissions,
    canManageRoles,
    setRoleToArchive,
    newRoleName,
    setNewRoleName,
    newRoleDescription,
    setNewRoleDescription,
    newRolePermissions,
    setNewRolePermissions,
    createRole,
  } = controller;
  return (
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Roles and permissions</h2>
          <p>Define reusable access profiles, then assign them to project members.</p>
        </div>
        <span className={styles.countBadge}>{project.roles.length}</span>
      </div>
      <div className={styles.roleList}>
        {project.roles.map((role) => (
          <RoleEditor
            key={role.id}
            projectId={projectId}
            role={role}
            canManage={canManageRoles}
            actorPermissions={permissions}
            onRequestArchive={setRoleToArchive}
          />
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
            <fieldset className={styles.permissionGrid}>
              <legend>Permissions</legend>
              {allPermissions.map((permission) => (
                <label key={permission}>
                  <input
                    type="checkbox"
                    checked={newRolePermissions.includes(permission)}
                    disabled={!permissions.includes(permission)}
                    onChange={(event) =>
                      setNewRolePermissions((current) =>
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
    </section>
  );
}

function MembersSection({ controller }: { controller: OverviewController }) {
  const {
    project,
    canInviteMembers,
    canManageMemberRoles,
    selectedUserId,
    setSelectedUserId,
    selectedRoleId,
    setSelectedRoleId,
    setMemberToRemove,
    assignableRoles,
    availableUsers,
    addMember,
    changeMemberRole,
  } = controller;
  return (
    <section className={styles.card}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Members</h2>
          <p>Add registered users and assign their project role.</p>
        </div>
        <span className={styles.countBadge}>{project.memberships.length}</span>
      </div>
      {canInviteMembers && (
        <form
          className={styles.addMemberForm}
          onSubmit={(event) => {
            event.preventDefault();
            addMember.mutate();
          }}
        >
          <label className={styles.field}>
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
            <span>Project role</span>
            <CustomSelect
              ariaLabel="Project role"
              value={selectedRoleId}
              onChange={setSelectedRoleId}
              options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
            />
          </label>
          <button
            className={styles.secondaryButton}
            type="submit"
            disabled={!selectedUserId || !selectedRoleId || addMember.isPending}
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
      <div className={styles.memberList} role="table" aria-label="Project members">
        {project.memberships.map((membership) => {
          const owner = membership.user.id === project.ownerUserId;
          return (
            <div className={styles.memberRow} role="row" key={membership.id}>
              <span className={styles.memberIdentity} role="cell">
                <strong>{membership.user.displayName}</strong>
                <small>{membership.user.email}</small>
              </span>
              <span className={styles.memberControls} role="cell">
                <CustomSelect
                  className={styles.memberRoleSelect}
                  ariaLabel={`Role for ${membership.user.displayName}`}
                  value={membership.role.id}
                  disabled={owner || !canManageMemberRoles || changeMemberRole.isPending}
                  onChange={(roleId) =>
                    changeMemberRole.mutate({
                      membershipId: membership.id,
                      roleId,
                      version: membership.version,
                    })
                  }
                  options={
                    owner
                      ? [{ value: membership.role.id, label: membership.role.name }]
                      : assignableRoles.map((role) => ({ value: role.id, label: role.name }))
                  }
                />
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label={`Remove ${membership.user.displayName} from project`}
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
    </section>
  );
}

function OverviewDialogs({ controller }: { controller: OverviewController }) {
  const {
    project,
    memberToRemove,
    setMemberToRemove,
    roleToArchive,
    setRoleToArchive,
    removeMember,
    archiveRole,
  } = controller;
  return (
    <>
      {memberToRemove && (
        <ConfirmationDialog
          title={`Remove ${memberToRemove.user.displayName}?`}
          description={
            <p>
              This person will immediately lose access to <strong>{project.name}</strong>. Their
              account and work history remain intact.
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
      {roleToArchive && (
        <ConfirmationDialog
          title={`Archive ${roleToArchive.name}?`}
          description={
            <p>
              This removes the role from future assignments. Existing members and pending
              invitations must be reassigned first.
            </p>
          }
          confirmLabel="Archive role"
          busyLabel="Archiving…"
          busy={archiveRole.isPending}
          error={archiveRole.error?.message}
          onCancel={() => {
            setRoleToArchive(undefined);
            archiveRole.reset();
          }}
          onConfirm={() => archiveRole.mutate(roleToArchive)}
        />
      )}
    </>
  );
}

export function OverviewView({ controller }: { controller: OverviewController }) {
  return (
    <>
      <header className={styles.pageIntro}>
        <h1>Project settings</h1>
        <p>Update this project’s public information and control who can work in it.</p>
      </header>
      <ProjectInformation controller={controller} />
      <RolesSection controller={controller} />
      <MembersSection controller={controller} />
      <OverviewDialogs controller={controller} />
    </>
  );
}

export function OverviewSection({ controller }: { controller: OverviewController }) {
  return <OverviewView controller={controller} />;
}
