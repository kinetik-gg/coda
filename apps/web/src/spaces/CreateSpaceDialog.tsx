import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSpace } from '../api';
import { ModalShell, modalButtonStyles, modalFormStyles } from '../components/ModalShell';

/**
 * Creates a Space from the sidebar's Space switcher (#335).
 *
 * Until this existed the Spaces feature was unreachable: every instance ships with one seeded
 * Default Space and the web client offered no way to make a second one, so membership, roles,
 * invitations, and resource moves had no Space a person could actually administer. The API already
 * enrols the creator as owner when it provisions the new Space, so the caller only has to wait for
 * the Space list to refetch before switching to it — otherwise the active-Space resolver would not
 * yet recognise the id and would snap back to the first visible Space.
 */
export function CreateSpaceDialog({
  onCreated,
  onClose,
}: {
  onCreated: (spaceId: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const cleanName = name.trim();
  const create = useMutation({
    mutationFn: () => createSpace({ name: cleanName, description: description.trim() }),
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      onCreated(space.id);
    },
  });

  return (
    <ModalShell
      config={{
        regions: {
          header: { title: 'Create Space' },
          body: {
            description: (
              <p>
                A Space groups screenplays and breakdowns and decides who can reach them. You become
                its owner.
              </p>
            ),
            content: (
              <div className={modalFormStyles.fields}>
                <label className={modalFormStyles.field}>
                  <span>Name</span>
                  <input
                    autoFocus
                    required
                    maxLength={160}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className={modalFormStyles.field}>
                  <span>Description</span>
                  <input
                    maxLength={4000}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                {create.error && (
                  <p className={modalFormStyles.error} role="alert">
                    {create.error.message}
                  </p>
                )}
              </div>
            ),
          },
          footer: (
            <>
              <button type="button" className={modalButtonStyles.secondary} onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className={modalButtonStyles.primary}
                disabled={!cleanName || create.isPending}
              >
                {create.isPending ? 'Creating…' : 'Create Space'}
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onClose, busy: create.isPending },
        form: {
          onSubmit: () => {
            if (cleanName && !create.isPending) create.mutate();
          },
        },
      }}
    />
  );
}
