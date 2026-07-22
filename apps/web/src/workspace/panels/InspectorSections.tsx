import { ChatCircleIcon } from '@phosphor-icons/react/dist/csr/ChatCircle';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import type { BreakdownItem } from './types';
import styles from './Panels.styles';

export interface InspectorComment {
  id: string;
  body: string;
  createdAt: string;
  author: { displayName: string };
}

export interface InspectorActivityEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  createdAt: string;
}

export function InspectorPropertySkeleton() {
  return (
    <SkeletonGroup label="Loading entity details" className={styles.inspectorSkeleton}>
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index}>
          <Skeleton width={index % 3 === 0 ? 58 : 76} height={8} />
          <Skeleton width={index === 0 ? '72%' : index % 3 === 1 ? '46%' : '88%'} height={10} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function InspectorReferences({ item }: { item: BreakdownItem }) {
  return (
    <div className={styles.referenceList}>
      {!item.sourceReferences.length && <p className={styles.empty}>No source references.</p>}
      {item.sourceReferences.map((reference, index) => (
        <div key={reference.id ?? index}>
          <span>REFERENCE {String(index + 1).padStart(2, '0')}</span>
          <strong>
            Pages {reference.startPage}–{reference.endPage}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function InspectorComments({
  data,
  error,
  isLoading,
  isPosting,
  body,
  onBodyChange,
  onPost,
  onRetry,
}: {
  data?: InspectorComment[];
  error: Error | null;
  isLoading: boolean;
  isPosting: boolean;
  body: string;
  onBodyChange: (body: string) => void;
  onPost: () => void;
  onRetry: () => void;
}) {
  return (
    <div className={styles.comments}>
      {isLoading && (
        <SkeletonGroup label="Loading comments" className={styles.listSkeleton}>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index}>
              <Skeleton width="38%" height={8} />
              <Skeleton width={index % 2 ? '78%' : '92%'} height={10} />
            </div>
          ))}
        </SkeletonGroup>
      )}
      {!isLoading && error && (
        <div className={styles.panelQueryState} role="alert">
          <span>Comments could not be loaded.</span>
          <button type="button" className={styles.queryStateAction} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!isLoading &&
        !error &&
        data?.map((comment) => (
          <article key={comment.id}>
            <header>
              {comment.author.displayName}
              <time>{new Date(comment.createdAt).toLocaleString()}</time>
            </header>
            <p>{comment.body}</p>
          </article>
        ))}
      {!isLoading && !error && !data?.length && <p className={styles.empty}>No comments.</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onPost();
        }}
      >
        <ChatCircleIcon size={12} />
        <input
          placeholder="Add a comment"
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
        />
        <button aria-label="Post comment" disabled={isPosting}>
          <PaperPlaneTiltIcon size={12} />
        </button>
      </form>
    </div>
  );
}

export function InspectorActivity({
  data,
  error,
  isLoading,
  itemId,
  onRetry,
}: {
  data?: InspectorActivityEntry[];
  error: Error | null;
  isLoading: boolean;
  itemId: string;
  onRetry: () => void;
}) {
  const visible = data?.filter((entry) => !entry.resourceId || entry.resourceId === itemId);
  return (
    <div className={styles.activity}>
      {isLoading && (
        <SkeletonGroup label="Loading item activity" className={styles.listSkeleton}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index}>
              <Skeleton width={index % 2 ? '62%' : '78%'} height={9} />
              <Skeleton width={108} height={8} />
            </div>
          ))}
        </SkeletonGroup>
      )}
      {!isLoading && error && (
        <div className={styles.panelQueryState} role="alert">
          <span>Activity could not be loaded.</span>
          <button type="button" className={styles.queryStateAction} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!isLoading &&
        !error &&
        visible?.map((entry) => (
          <article key={entry.id}>
            <span>
              {entry.action} {entry.resourceType}
            </span>
            <time>{new Date(entry.createdAt).toLocaleString()}</time>
          </article>
        ))}
      {!isLoading && !error && !visible?.length && (
        <p className={styles.empty}>No activity for this item.</p>
      )}
    </div>
  );
}
