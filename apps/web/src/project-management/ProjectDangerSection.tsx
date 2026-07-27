import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { api } from '../api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
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

  return { confirming, setConfirming, canDelete, moveToTrash };
}

export type ProjectDangerController = ReturnType<typeof useProjectDangerController>;

export function ProjectDangerSection({
  project,
  controller,
}: {
  project: ManagedProject;
  controller: ProjectDangerController;
}) {
  const { confirming, setConfirming, canDelete, moveToTrash } = controller;
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
    </>
  );
}
