import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ModalShell, modalButtonStyles, modalFormStyles } from '../components/ModalShell';
import { useProjectDetailsController } from '../project-management/useProjectDetailsController';
import type { ManagedProject } from '../project-management/types';

/**
 * Renaming a breakdown and editing its description (#169).
 *
 * The breakdown's information is persistent detail, so it *reads* in the inspector; changing it is
 * a focused transient task, so it happens here — the same rule the screenplay side follows, where
 * the inspector shows the title and rename is its own dialog. This replaces the editable
 * information card that used to occupy the breakdown settings page.
 *
 * The management payload carries the optimistic-concurrency version, and it is the read the
 * inspector has already warmed under the same key, so opening this dialog from a selected row
 * costs no additional request.
 */
export function BreakdownDetailsDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const management = useQuery({
    queryKey: ['project-management', projectId],
    queryFn: () => api<ManagedProject>(`/api/v1/projects/${projectId}/management`),
    retry: false,
  });
  const project = management.data;
  const details = useProjectDetailsController({
    projectId,
    project,
    onSaved: onClose,
  });
  const { name, setName, description, setDescription, save, submittable } = details;

  return (
    <ModalShell
      config={{
        regions: {
          header: { eyebrow: 'Details', title: 'Breakdown details' },
          body: {
            description: (
              <p>The name and description shown in breakdown lists, selectors, and exports.</p>
            ),
            content: (
              <>
                {management.error ? (
                  <p className={modalFormStyles.error} role="alert">
                    These details could not be read. Check your access, then try again.
                  </p>
                ) : (
                  <div className={modalFormStyles.fields}>
                    <label>
                      <span>Name</span>
                      <input
                        autoFocus
                        required
                        maxLength={160}
                        value={name}
                        disabled={!project}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea
                        rows={4}
                        maxLength={4000}
                        value={description}
                        disabled={!project}
                        placeholder="Describe the purpose of this breakdown."
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </label>
                  </div>
                )}
                {save.error && (
                  <p className={modalFormStyles.error} role="alert">
                    {save.error.message}
                  </p>
                )}
              </>
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
                disabled={save.isPending || !submittable}
              >
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onClose, busy: save.isPending },
        form: {
          onSubmit: () => {
            if (submittable) save.mutate(undefined);
          },
        },
      }}
    />
  );
}
