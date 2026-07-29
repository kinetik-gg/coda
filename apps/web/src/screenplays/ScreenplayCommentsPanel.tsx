import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowBendUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowBendUpLeft';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { ChatCircleDotsIcon } from '@phosphor-icons/react/dist/csr/ChatCircleDots';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { ScreenplayCommentThreadView, ScreenplayCommentView } from '@coda/contracts';
import type * as Y from 'yjs';
import { api } from '../api';
import type { ScreenplaySourceSelection } from './screenplay-preview-model';
import {
  createScreenplayCommentAnchor,
  resolveScreenplayCommentAnchor,
  type ResolvedScreenplayCommentAnchor,
} from './screenplay-comment-anchors';
import { useScreenplayComments, type ScreenplayCommentThreadFilter } from './useScreenplayComments';
import styles from './ScreenplayCommentsPanel.module.css';

interface ScreenplayCommentsPanelProps {
  screenplayId: string;
  status: ScreenplayCommentThreadFilter;
  text: Y.Text;
  sourceText: string;
  selection: ScreenplaySourceSelection;
  canEdit: boolean;
  canManage: boolean;
  onReveal: (start: number, end: number) => void;
}

function NewThreadForm({
  selectedText,
  pending,
  onCreate,
}: {
  selectedText: string;
  pending: boolean;
  onCreate: (body: string) => void;
}) {
  const [body, setBody] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedText || !body.trim()) return;
    onCreate(body.trim());
    setBody('');
  };
  return (
    <form className={styles.newThread} onSubmit={submit}>
      <span className={styles.selectionLabel}>
        {selectedText
          ? `Selected: “${selectedText.slice(0, 120)}”`
          : 'Select script text to anchor a comment.'}
      </span>
      <textarea
        aria-label="New thread comment"
        placeholder="Start a comment thread"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button type="submit" disabled={!selectedText || !body.trim() || pending}>
        <ChatCircleDotsIcon size={14} aria-hidden="true" />
        Start thread
      </button>
    </form>
  );
}

function CommentEntry({
  comment,
  canChange,
  onEdit,
  onDelete,
}: {
  comment: ScreenplayCommentView;
  canChange: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? '');
  if (comment.deletedAt) {
    return <li className={styles.deletedComment}>Comment deleted.</li>;
  }
  return (
    <li className={styles.comment}>
      <header>
        <strong>{comment.author.displayName}</strong>
        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
      </header>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            onEdit(draft.trim());
            setEditing(false);
          }}
        >
          <textarea
            aria-label={`Edit comment by ${comment.author.displayName}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.inlineActions}>
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p>{comment.body}</p>
      )}
      {canChange && !editing && (
        <div className={styles.commentActions}>
          <button type="button" aria-label="Edit comment" onClick={() => setEditing(true)}>
            <PencilSimpleIcon size={12} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Delete comment" onClick={onDelete}>
            <TrashIcon size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}

function ThreadCard({
  thread,
  anchor,
  currentUserId,
  canEdit,
  canManage,
  pending,
  onReveal,
  onReply,
  onEdit,
  onDelete,
  onResolve,
}: {
  thread: ScreenplayCommentThreadView;
  anchor: ResolvedScreenplayCommentAnchor;
  currentUserId?: string;
  canEdit: boolean;
  canManage: boolean;
  pending: boolean;
  onReveal: () => void;
  onReply: (body: string) => void;
  onEdit: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
  onResolve: (resolved: boolean) => void;
}) {
  const [reply, setReply] = useState('');
  const resolved = thread.status === 'RESOLVED';
  const canResolve = thread.authorUserId === currentUserId || canEdit;
  return (
    <article className={styles.thread} data-detached={anchor.detached}>
      <header className={styles.threadHeader}>
        <button
          type="button"
          className={styles.quote}
          onClick={onReveal}
          disabled={anchor.detached}
        >
          <span>{anchor.detached ? 'Detached thread' : 'Anchored range'}</span>
          <q>{thread.quotedText || 'Empty selection'}</q>
        </button>
        {canResolve && (
          <button
            type="button"
            className={styles.resolveButton}
            onClick={() => onResolve(!resolved)}
            disabled={pending}
          >
            {resolved ? (
              <ArrowBendUpLeftIcon size={12} aria-hidden="true" />
            ) : (
              <CheckCircleIcon size={12} aria-hidden="true" />
            )}
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
        )}
      </header>
      <ol className={styles.commentList}>
        {thread.comments.map((comment) => (
          <CommentEntry
            key={comment.id}
            comment={comment}
            canChange={comment.authorUserId === currentUserId || canManage}
            onEdit={(body) => onEdit(comment.id, body)}
            onDelete={() => onDelete(comment.id)}
          />
        ))}
      </ol>
      {!resolved && (
        <form
          className={styles.reply}
          onSubmit={(event) => {
            event.preventDefault();
            if (!reply.trim()) return;
            onReply(reply.trim());
            setReply('');
          }}
        >
          <input
            aria-label={`Reply to thread about ${thread.quotedText}`}
            placeholder="Reply"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
          <button type="submit" disabled={!reply.trim() || pending}>
            Reply
          </button>
        </form>
      )}
    </article>
  );
}

export function ScreenplayCommentsPanel({
  screenplayId,
  status,
  text,
  sourceText,
  selection,
  canEdit,
  canManage,
  onReveal,
}: ScreenplayCommentsPanelProps) {
  const controller = useScreenplayComments(screenplayId, status);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<{ id: string }>('/api/v1/auth/session'),
  });
  const selectedText = sourceText.slice(selection.from, selection.to);
  const anchoredThreads = useMemo(
    () =>
      (controller.threads.data ?? []).map((thread) => ({
        thread,
        anchor: resolveScreenplayCommentAnchor(text, thread.anchorStart, thread.anchorEnd),
      })),
    [controller.threads.data, text],
  );
  const mutationError =
    controller.createThread.error ??
    controller.reply.error ??
    controller.updateComment.error ??
    controller.deleteComment.error ??
    controller.setResolved.error;
  const pending =
    controller.createThread.isPending ||
    controller.reply.isPending ||
    controller.updateComment.isPending ||
    controller.deleteComment.isPending ||
    controller.setResolved.isPending;

  return (
    <div className={styles.panel}>
      <NewThreadForm
        selectedText={selectedText}
        pending={controller.createThread.isPending}
        onCreate={(body) =>
          controller.createThread.mutate({
            ...createScreenplayCommentAnchor(text, selection.from, selection.to),
            body,
          })
        }
      />
      {controller.threads.isLoading && <p className={styles.state}>Loading threads…</p>}
      {controller.threads.error && (
        <p className={styles.state} role="alert">
          Threads could not be loaded.
          <button type="button" onClick={() => void controller.threads.refetch()}>
            Retry
          </button>
        </p>
      )}
      {mutationError && (
        <p className={styles.error} role="alert">
          {mutationError.message}
        </p>
      )}
      <div className={styles.threadList}>
        {anchoredThreads.map(({ thread, anchor }) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            anchor={anchor}
            currentUserId={session.data?.id}
            canEdit={canEdit}
            canManage={canManage}
            pending={pending}
            onReveal={() => onReveal(anchor.start, anchor.end)}
            onReply={(body) => controller.reply.mutate({ threadId: thread.id, body })}
            onEdit={(commentId, body) => controller.updateComment.mutate({ commentId, body })}
            onDelete={(commentId) => controller.deleteComment.mutate(commentId)}
            onResolve={(resolved) =>
              controller.setResolved.mutate({ threadId: thread.id, resolved })
            }
          />
        ))}
        {!controller.threads.isLoading &&
          !controller.threads.error &&
          anchoredThreads.length === 0 && (
            <p className={styles.state}>No {status === 'all' ? '' : `${status} `}threads.</p>
          )}
      </div>
    </div>
  );
}
