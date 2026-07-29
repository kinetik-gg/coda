import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResourceType } from '@coda/contracts';
import { api, listSpaces } from '../api';
import { CustomSelect } from '../components/CustomSelect';
import { ModalShell, modalButtonStyles, modalFormStyles } from '../components/ModalShell';

interface MovePreflight {
  gainsAccess: string[];
  losesAccess: string[];
}

function accessList({ title, users }: { title: string; users: string[] }) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {users.length ? (
        <ul>
          {users.map((userId) => (
            <li key={userId}>{userId}</li>
          ))}
        </ul>
      ) : (
        <p>None.</p>
      )}
    </section>
  );
}

/**
 * Confirms the sharing consequences of relocating a resource before the move endpoint can run.
 * Direct resource memberships are intentionally absent from the preflight: their access survives
 * unchanged, independent of either Space.
 */
export function MoveToSpaceDialog({
  resourceType,
  resourceId,
  resourceName,
  sourceSpaceId,
  onClose,
}: {
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  sourceSpaceId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [targetSpaceId, setTargetSpaceId] = useState('');
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: listSpaces, retry: false });
  const targets = (spaces.data ?? []).filter(
    (space) =>
      space.id !== sourceSpaceId &&
      space.currentMembership?.role.permissions.some(
        ({ permission }) => permission === 'move_resources',
      ),
  );
  useEffect(() => {
    if (!targets.some((space) => space.id === targetSpaceId))
      setTargetSpaceId(targets[0]?.id ?? '');
  }, [targetSpaceId, targets]);
  const preflight = useQuery({
    queryKey: ['space-move-preflight', sourceSpaceId, resourceType, resourceId, targetSpaceId],
    queryFn: () =>
      api<MovePreflight>(
        `/api/v1/spaces/${sourceSpaceId}/resources/${resourceType}/${resourceId}/move-preflight?targetSpaceId=${targetSpaceId}`,
      ),
    enabled: Boolean(targetSpaceId),
    retry: false,
  });
  const move = useMutation({
    mutationFn: () =>
      api(`/api/v1/spaces/${sourceSpaceId}/resources/move`, {
        method: 'POST',
        body: JSON.stringify({ resourceType, resourceId, targetSpaceId }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['screenplays'] }),
        queryClient.invalidateQueries({ queryKey: ['spaces'] }),
      ]);
      onClose();
    },
  });
  const sourceRefusal = preflight.error?.message;

  return (
    <ModalShell
      config={{
        regions: {
          header: { title: 'Move to Space' },
          body: {
            description: (
              <p>
                Move <strong>{resourceName}</strong> and review how Space access changes.
              </p>
            ),
            content: (
              <div className={modalFormStyles.fields}>
                <label>
                  <span>Destination Space</span>
                  <CustomSelect
                    ariaLabel="Destination Space"
                    value={targetSpaceId}
                    disabled={spaces.isLoading || !targets.length}
                    placeholder={targets.length ? 'Select a Space' : 'No eligible Spaces'}
                    onChange={setTargetSpaceId}
                    options={targets.map((space) => ({ value: space.id, label: space.name }))}
                  />
                </label>
                {!targets.length && !spaces.isLoading && (
                  <p role="status">
                    You need <strong>Move resources</strong> permission in another Space.
                  </p>
                )}
                {preflight.isLoading && <p role="status">Checking access changes…</p>}
                {preflight.data && (
                  <>
                    {accessList({
                      title: 'Members who gain access',
                      users: preflight.data.gainsAccess,
                    })}
                    {accessList({
                      title: 'Members who lose access',
                      users: preflight.data.losesAccess,
                    })}
                    <p>
                      People with direct membership in this resource are unaffected by this move.
                    </p>
                  </>
                )}
                {sourceRefusal && (
                  <p className={modalFormStyles.error} role="alert">
                    This move could not be authorized. You need Move resources permission in both
                    the source and destination Spaces. {sourceRefusal}
                  </p>
                )}
                {move.error && (
                  <p className={modalFormStyles.error} role="alert">
                    {move.error.message}
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
                type="button"
                className={modalButtonStyles.primary}
                disabled={!preflight.data || move.isPending}
                onClick={() => move.mutate()}
              >
                {move.isPending ? 'Moving…' : 'Move to Space'}
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onClose, busy: move.isPending },
      }}
    />
  );
}
