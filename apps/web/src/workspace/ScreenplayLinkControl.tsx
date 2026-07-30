import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinkBreakIcon } from '@phosphor-icons/react/dist/csr/LinkBreak';
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple';
import type { BreakdownScreenplayLinkState, BreakdownScreenplayLinkView } from '@coda/contracts';
import { api } from '../api';
import type { ScreenplaySummary } from '../screenplays/types';
import { StatusBarSegment } from './shell';
import styles from './ScreenplayLinkControl.module.css';

export function screenplayLinkQueryKey(projectId: string): [string, string] {
  return ['breakdown-screenplay-link', projectId];
}

const linkPath = (projectId: string) => `/api/v1/projects/${projectId}/screenplay-link`;

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The screenplay a linked breakdown follows, or the reason it cannot be named. */
function LinkedName({ link }: { link: BreakdownScreenplayLinkView }) {
  if (!link.screenplay) {
    return (
      <span
        className={`${styles.name} ${styles.unavailable}`}
        title="The linked screenplay is in trash, has been deleted, or is no longer shared with you. Unlink to clear it."
      >
        Unavailable
      </span>
    );
  }
  return (
    <span className={styles.name} title={link.screenplay.filename}>
      {link.screenplay.title}
    </span>
  );
}

function Picker({
  busy,
  onCancel,
  onChoose,
}: {
  busy: boolean;
  onCancel: () => void;
  onChoose: (screenplayId: string) => void;
}) {
  const [choice, setChoice] = useState('');
  // Fetched only once the picker is open: a breakdown that never follows a screenplay should not
  // pay for the screenplay list on every workspace mount.
  const screenplays = useQuery({
    queryKey: ['screenplays'],
    queryFn: () => api<ScreenplaySummary[]>('/api/v1/screenplays'),
  });
  return (
    <>
      <select
        className={styles.picker}
        aria-label="Screenplay to follow"
        value={choice}
        disabled={busy || screenplays.isLoading}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">{screenplays.isLoading ? 'Loading…' : 'Select a screenplay'}</option>
        {(screenplays.data ?? []).map((screenplay) => (
          <option key={screenplay.id} value={screenplay.id}>
            {screenplay.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.action}
        disabled={!choice || busy}
        onClick={() => onChoose(choice)}
      >
        <LinkSimpleIcon size={12} aria-hidden="true" />
        <span>{busy ? 'Linking…' : 'Link'}</span>
      </button>
      <button type="button" className={styles.action} disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      {screenplays.error ? (
        <span className={styles.error} role="alert">
          {message(screenplays.error, 'Screenplays could not be listed.')}
        </span>
      ) : null}
    </>
  );
}

function LinkActions({
  state,
  busy,
  unlinking,
  onPick,
  onUnlink,
}: {
  state: BreakdownScreenplayLinkState;
  busy: boolean;
  unlinking: boolean;
  onPick: () => void;
  onUnlink: () => void;
}) {
  // A control the API would reject is never offered — the same rule projects/access.ts follows.
  if (!state.canLink) return null;
  return (
    <>
      <button type="button" className={styles.action} disabled={busy} onClick={onPick}>
        <LinkSimpleIcon size={12} aria-hidden="true" />
        <span>{state.link ? 'Change' : 'Link'}</span>
      </button>
      {state.link ? (
        <button type="button" className={styles.action} disabled={busy} onClick={onUnlink}>
          <LinkBreakIcon size={12} aria-hidden="true" />
          <span>{unlinking ? 'Unlinking…' : 'Unlink'}</span>
        </button>
      ) : null}
    </>
  );
}

/**
 * The minimal workspace control for the breakdown↔screenplay link (issue #238).
 *
 * It only ever calls the dedicated link endpoint. It never reads or writes a source document, a
 * storage object, or an item source reference, so linking and unlinking here cannot change what an
 * existing PDF source reference resolves to — the invariant the API guarantees is not quietly
 * undone by the UI.
 */
export function ScreenplayLinkControl({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string>();

  const state = useQuery({
    queryKey: screenplayLinkQueryKey(projectId),
    queryFn: () => api<BreakdownScreenplayLinkState>(linkPath(projectId)),
    staleTime: 30_000,
  });

  const settle = async () => {
    setPicking(false);
    setError(undefined);
    await queryClient.invalidateQueries({ queryKey: screenplayLinkQueryKey(projectId) });
  };

  const save = useMutation({
    mutationFn: (screenplayId: string) =>
      api<BreakdownScreenplayLinkState>(linkPath(projectId), {
        method: 'PUT',
        body: JSON.stringify({ screenplayId }),
      }),
    onSuccess: settle,
    onError: (failure) => setError(message(failure, 'The screenplay could not be linked.')),
  });

  const clear = useMutation({
    mutationFn: () => api<BreakdownScreenplayLinkState>(linkPath(projectId), { method: 'DELETE' }),
    onSuccess: settle,
    onError: (failure) => setError(message(failure, 'The screenplay could not be unlinked.')),
  });

  if (!state.data) return null;

  const busy = save.isPending || clear.isPending;
  return (
    <StatusBarSegment icon={<LinkSimpleIcon size={12} aria-hidden="true" />}>
      <span className={styles.control}>
        <span>Screenplay:</span>
        {picking ? null : state.data.link ? (
          <LinkedName link={state.data.link} />
        ) : (
          <span className={styles.name}>None</span>
        )}
        {picking ? (
          <Picker
            busy={busy}
            onCancel={() => {
              setPicking(false);
              setError(undefined);
            }}
            onChoose={(screenplayId) => save.mutate(screenplayId)}
          />
        ) : (
          <LinkActions
            state={state.data}
            busy={busy}
            unlinking={clear.isPending}
            onPick={() => {
              setError(undefined);
              setPicking(true);
            }}
            onUnlink={() => clear.mutate()}
          />
        )}
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </span>
    </StatusBarSegment>
  );
}
