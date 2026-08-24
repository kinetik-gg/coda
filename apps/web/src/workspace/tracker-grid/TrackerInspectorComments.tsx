import { useState } from 'react';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { absoluteTime, relativeTime } from '../../content-lists';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import type { TrackerComment, TrackerCurrentUser } from '../../trackers/types';
import { commentActionMessage, useTrackerComments } from './use-tracker-comments';
import panelsStyles from '../panels/Panels.styles';
import styles from './TrackerInspectorComments.module.css';

function CommentTimestamps({ comment }: { comment: TrackerComment }) {
  return (
    <span className={styles.timestampGroup}>
      <time dateTime={comment.createdAt} title={absoluteTime(comment.createdAt)}>
        {relativeTime(comment.createdAt)}
      </time>
      {comment.editedAt && (
        <time
          className={styles.editedMarker}
          dateTime={comment.editedAt}
          title={`Edited ${absoluteTime(comment.editedAt)}`}
        >
          (edited)
        </time>
      )}
    </span>
  );
}

/** The inline author-only editor: a textarea restating the body plus explicit save/cancel. */
function CommentEditor({
  comment,
  busy,
  error,
  onSave,
  onCancel,
}: {
  comment: TrackerComment;
  busy: boolean;
  error: unknown;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(comment.body);
  const save = async () => {
    const body = draft.trim();
    if (!body || body === comment.body || busy) return;
    try {
      await onSave(body);
    } catch {
      /* surfaced through the shared inline error */
    }
  };
  return (
    <div className={styles.editor}>
      <textarea
        aria-label="Edit comment"
        value={draft}
        disabled={busy}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          void save();
        }}
      />
      {Boolean(error) && (
        <p className={styles.actionError} role="alert">
          {commentActionMessage(error)}
        </p>
      )}
      <div className={styles.editorActions}>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryAction}
          disabled={busy || !draft.trim() || draft.trim() === comment.body}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Composer({ busy, onPost }: { busy: boolean; onPost: (body: string) => Promise<void> }) {
  const [draft, setDraft] = useState('');
  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    try {
      await onPost(body);
      setDraft('');
    } catch {
      /* surfaced through the shared inline error */
    }
  };
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        placeholder="Add a comment"
        aria-label="Add a comment"
        value={draft}
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          void send();
        }}
      />
      <button
        type="submit"
        aria-label="Post comment"
        className={styles.sendButton}
        disabled={busy || !draft.trim()}
      >
        <PaperPlaneTiltIcon size={12} aria-hidden="true" />
      </button>
    </form>
  );
}

/**
 * The tracker inspector's record-comments section (#383): the selected record's flat comments
 * oldest first with author names, relative timestamps, and edited markers; Enter-to-send
 * composer at the bottom; author-only inline edit and confirmed delete; cursor "Load more"
 * whenever a full page returns. Permission gaps surface as the API's inline problem details.
 */
export function TrackerInspectorComments({
  trackerId,
  recordId,
  currentUser,
}: {
  trackerId: string;
  recordId: string;
  currentUser: TrackerCurrentUser;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<TrackerComment>();
  const comments = useTrackerComments({ trackerId, recordId, currentUser });
  const isOwn = (comment: TrackerComment) => comment.authorId === currentUser.id;

  const postComment = async (body: string) => {
    await comments.post.mutateAsync(body);
  };
  const saveEdit = async (comment: TrackerComment, body: string) => {
    await comments.edit.mutateAsync({ comment, body });
    setEditingId(undefined);
  };

  return (
    <div className={styles.section} aria-busy={comments.isLoading}>
      {comments.isLoading && (
        <SkeletonGroup label="Loading comments" className={panelsStyles.listSkeleton}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}>
              <Skeleton width="38%" height={8} />
              <Skeleton width={index % 2 ? '78%' : '92%'} height={10} />
            </div>
          ))}
        </SkeletonGroup>
      )}
      {!comments.isLoading && comments.error && (
        <div className={panelsStyles.panelQueryState} role="alert">
          <span>Comments could not be loaded.</span>
          <button
            type="button"
            className={panelsStyles.queryStateAction}
            onClick={comments.refetch}
          >
            Retry
          </button>
        </div>
      )}
      {!comments.isLoading &&
        !comments.error &&
        (comments.items.length ? (
          comments.items.map((comment) =>
            editingId === comment.id ? (
              <CommentEditor
                key={comment.id}
                comment={comment}
                busy={comments.edit.isPending}
                error={comments.edit.error}
                onSave={(body) => saveEdit(comment, body)}
                onCancel={() => setEditingId(undefined)}
              />
            ) : (
              <article key={comment.id} className={styles.comment}>
                <header className={styles.commentHeader}>
                  <span>{comment.author.displayName}</span>
                  <CommentTimestamps comment={comment} />
                </header>
                <p>{comment.body}</p>
                {isOwn(comment) && (
                  <div className={styles.commentActions}>
                    <button
                      type="button"
                      onClick={() => setEditingId(comment.id)}
                      aria-label={`Edit comment: ${comment.body.slice(0, 40)}`}
                    >
                      <PencilSimpleIcon size={12} aria-hidden="true" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(comment)}
                      aria-label={`Delete comment: ${comment.body.slice(0, 40)}`}
                    >
                      <TrashIcon size={12} aria-hidden="true" /> Delete…
                    </button>
                  </div>
                )}
              </article>
            ),
          )
        ) : (
          <p className={styles.empty}>No comments.</p>
        ))}
      {!comments.isLoading && !comments.error && comments.hasNextPage && (
        <button
          type="button"
          className={styles.loadMore}
          disabled={comments.isFetchingNextPage}
          onClick={comments.fetchNextPage}
        >
          {comments.isFetchingNextPage ? 'Loading more…' : 'Load more comments'}
        </button>
      )}
      {comments.remove.error && (
        <p className={styles.actionError} role="alert">
          {commentActionMessage(comments.remove.error)}
        </p>
      )}
      <Composer busy={comments.post.isPending} onPost={postComment} />
      {comments.post.error && (
        <p className={styles.actionError} role="alert">
          {commentActionMessage(comments.post.error)}
        </p>
      )}
      {pendingDelete && (
        <ConfirmationDialog
          title="Delete this comment?"
          description={<p>The comment is removed for everyone. This cannot be undone.</p>}
          confirmLabel="Delete comment"
          busy={comments.remove.isPending}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => {
            void comments.remove.mutateAsync(pendingDelete).finally(() => {
              setPendingDelete(undefined);
            });
          }}
        />
      )}
    </div>
  );
}
