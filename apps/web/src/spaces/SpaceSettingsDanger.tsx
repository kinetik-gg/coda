import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { api } from '../api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { CustomSelect } from '../components/CustomSelect';
import styles from '../ProjectManagementScreen.styles';
import { spacePermission, type ManagedSpace } from './space-settings-model';

export function DangerSection({
  space,
  onDeleted,
}: {
  space: ManagedSpace;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [newOwnerMembershipId, setNewOwnerMembershipId] = useState('');
  const owner = space.memberships.find((membership) => membership.role.isOwner);
  const canTransfer = !space.isDefault && owner?.id === space.currentMembership?.id;
  const canDelete =
    !space.isDefault && space._count.resources === 0 && spacePermission(space, 'delete_space');
  const targets = space.memberships.filter(
    (membership) => membership.id !== owner?.id && membership.user,
  );
  const transfer = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${space.id}/transfer-ownership`, {
        method: 'POST',
        body: JSON.stringify({ newOwnerMembershipId, version: space.version }),
      }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/spaces/${space.id}`, { method: 'DELETE' }),
    onSuccess: onDeleted,
  });
  return (
    <>
      <section>
        <header className={styles.pageIntro}>
          <h1>Danger</h1>
          <p>Ownership and deletion change who can control this Space and its resources.</p>
        </header>
        <section className={styles.section}>
          <div className={styles.operationRow}>
            <div>
              <h2>Transfer ownership</h2>
              <p>
                {space.isDefault
                  ? 'The Default Space has zero memberships by design, so its ownership cannot be transferred.'
                  : 'Transfer settings ownership to another Space member.'}
              </p>
            </div>
            {canTransfer ? (
              <form
                className={styles.addMemberForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (newOwnerMembershipId) transfer.mutate();
                }}
              >
                <CustomSelect
                  ariaLabel="New owner"
                  value={newOwnerMembershipId}
                  disabled={!targets.length}
                  placeholder={targets.length ? 'Select a member' : 'No other members'}
                  onChange={setNewOwnerMembershipId}
                  options={targets.map((membership) => ({
                    value: membership.id,
                    label: `${membership.user?.displayName ?? 'Member'} — ${membership.user?.email ?? ''}`,
                  }))}
                />
                <button
                  className={styles.secondaryButton}
                  type="submit"
                  disabled={!newOwnerMembershipId || transfer.isPending}
                >
                  {transfer.isPending ? 'Transferring…' : 'Transfer ownership'}
                </button>
                {transfer.error && (
                  <p className={styles.error} role="alert">
                    {transfer.error.message}
                  </p>
                )}
              </form>
            ) : (
              <p className={styles.inlineHelp}>
                {space.isDefault
                  ? 'Disabled for the Default Space.'
                  : 'Only the current owner-role member can transfer ownership.'}
              </p>
            )}
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.dangerAction}>
            <div>
              <h2>Delete Space</h2>
              <p>
                {space.isDefault
                  ? 'The Default Space cannot be deleted.'
                  : space._count.resources
                    ? `Move all ${space._count.resources} resources into another Space before deleting this one.`
                    : 'This permanently removes the empty Space.'}
              </p>
            </div>
            {canDelete ? (
              <button
                className={styles.dangerButton}
                type="button"
                onClick={() => setConfirming(true)}
              >
                <TrashIcon size={12} aria-hidden /> Delete Space…
              </button>
            ) : (
              <p className={styles.inlineHelp}>
                {space.isDefault
                  ? 'Disabled for the Default Space.'
                  : 'Move resources first or obtain deletion permission.'}
              </p>
            )}
          </div>
        </section>
      </section>
      {confirming && (
        <ConfirmationDialog
          title="Delete Space?"
          description={
            <p>
              <strong>{space.name}</strong> is empty and will be permanently removed.
            </p>
          }
          confirmLabel="Delete Space"
          busy={remove.isPending}
          error={remove.error?.message}
          onCancel={() => setConfirming(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  );
}
