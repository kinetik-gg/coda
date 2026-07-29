import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { api } from '../api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { CustomSelect } from '../components/CustomSelect';
import { MoveToSpaceDialog } from '../spaces/MoveToSpaceDialog';
import styles from '../ProjectManagementScreen.styles';
import type { ManagedProject } from './types';

export function useProjectDangerController({
  project,
  onDeleted,
}: {
  project: ManagedProject;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newOwnerMembershipId, setNewOwnerMembershipId] = useState('');
  const ownerMembership = project.memberships.find(
    (membership) => membership.user.id === project.ownerUserId,
  );
  const canDelete =
    project.currentMembership?.id === ownerMembership?.id &&
    project.currentMembership?.permissions.includes('delete_project');
  const moveToTrash = useMutation({
    mutationFn: () => api(`/api/v1/projects/${project.id}/trash`, { method: 'DELETE' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['trashed-projects'] }),
      ]);
      setConfirming(false);
      onDeleted();
    },
  });
  const canTransfer = project.currentMembership?.id === ownerMembership?.id;
  const transferCandidates = project.memberships.filter(
    (membership) => membership.id !== ownerMembership?.id,
  );
  const transferOwnership = useMutation({
    mutationFn: () =>
      api(`/api/v1/projects/${project.id}/transfer-ownership`, {
        method: 'POST',
        body: JSON.stringify({ newOwnerMembershipId, version: project.version }),
      }),
    onSuccess: async () => {
      setNewOwnerMembershipId('');
      await queryClient.invalidateQueries({ queryKey: ['project-management', project.id] });
    },
  });

  return {
    confirming,
    setConfirming,
    moving,
    setMoving,
    canDelete,
    moveToTrash,
    canTransfer,
    transferCandidates,
    newOwnerMembershipId,
    setNewOwnerMembershipId,
    transferOwnership,
  };
}

export type ProjectDangerController = ReturnType<typeof useProjectDangerController>;

export function ProjectDangerSection({
  project,
  controller,
  sourceSpaceId,
}: {
  project: ManagedProject;
  controller: ProjectDangerController;
  sourceSpaceId?: string;
}) {
  const {
    confirming,
    setConfirming,
    moving,
    setMoving,
    canDelete,
    moveToTrash,
    canTransfer,
    transferCandidates,
    newOwnerMembershipId,
    setNewOwnerMembershipId,
    transferOwnership,
  } = controller;
  return (
    <>
      <section aria-labelledby="project-management-danger-title">
        <header className={styles.pageIntro}>
          <h1 id="project-management-danger-title">Danger zone</h1>
          <p>
            Destructive actions stay recoverable where possible and always require confirmation.
          </p>
        </header>
        <div className={styles.dangerAction}>
          <div>
            <h2>Transfer ownership</h2>
            <p>Transfer ownership to another member. You keep your current access role.</p>
          </div>
          {canTransfer ? (
            <form
              className={styles.addMemberForm}
              onSubmit={(event) => {
                event.preventDefault();
                if (newOwnerMembershipId) transferOwnership.mutate();
              }}
            >
              <CustomSelect
                ariaLabel="New owner"
                value={newOwnerMembershipId}
                placeholder={transferCandidates.length ? 'Select a member' : 'No other members'}
                disabled={!transferCandidates.length}
                onChange={setNewOwnerMembershipId}
                options={transferCandidates.map((membership) => ({
                  value: membership.id,
                  label: `${membership.user.displayName} — ${membership.user.email}`,
                }))}
              />
              <button
                type="submit"
                className={styles.secondaryButton}
                disabled={!newOwnerMembershipId || transferOwnership.isPending}
              >
                {transferOwnership.isPending ? 'Transferring…' : 'Transfer ownership'}
              </button>
              {transferOwnership.error && (
                <p className={styles.error} role="alert">
                  {transferOwnership.error.message}
                </p>
              )}
            </form>
          ) : (
            <p className={styles.inlineHelp}>Only the current owner can transfer ownership.</p>
          )}
        </div>
        <div className={styles.dangerAction}>
          <div>
            <h2>Move breakdown to trash</h2>
            <p>
              The breakdown and everything it holds stay recoverable for 30 days, then are
              permanently removed.
            </p>
          </div>
          {canDelete ? (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => setConfirming(true)}
            >
              <TrashIcon size={12} aria-hidden="true" /> Move to trash…
            </button>
          ) : (
            <p className={styles.inlineHelp}>
              Only the breakdown owner with deletion permission can move it to trash.
            </p>
          )}
        </div>
        {sourceSpaceId && (
          <div className={styles.dangerAction}>
            <div>
              <h2>Move to Space</h2>
              <p>
                Move this breakdown to another Space and review who gains or loses access first.
              </p>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setMoving(true)}
            >
              Move to Space…
            </button>
          </div>
        )}
      </section>
      {confirming && (
        <ConfirmationDialog
          title="Move breakdown to trash?"
          description={
            <p>
              <strong>{project.name}</strong> and everything it holds stays recoverable for 30 days,
              then is permanently removed.
            </p>
          }
          confirmLabel="Move to trash"
          busyLabel="Moving…"
          busy={moveToTrash.isPending}
          error={moveToTrash.error?.message}
          onCancel={() => {
            if (!moveToTrash.isPending) {
              moveToTrash.reset();
              setConfirming(false);
            }
          }}
          onConfirm={() => moveToTrash.mutate()}
        />
      )}
      {moving && sourceSpaceId && (
        <MoveToSpaceDialog
          resourceType="breakdown"
          resourceId={project.id}
          resourceName={project.name}
          sourceSpaceId={sourceSpaceId}
          onClose={() => setMoving(false)}
        />
      )}
    </>
  );
}
