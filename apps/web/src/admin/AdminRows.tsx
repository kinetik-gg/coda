import { useEffect, useRef, useState } from 'react';
import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import styles from '../AdminScreen.styles';
import { EmptyState } from './AdminCommon';
import type {
  ActivityEntry,
  InstanceInvitation,
  InstanceJob,
  InstanceProject,
  InstanceUser,
  StorageItem,
} from './types';
import { bytes, dateTime, duration, metadataEntries } from './utils';

export function ProjectRows({ items }: { items: InstanceProject[] }) {
  if (!items.length) {
    return (
      <EmptyState icon={<BuildingsIcon size={20} />} title="No breakdowns yet">
        Breakdowns will appear here when members create them.
      </EmptyState>
    );
  }
  return (
    <div className={styles.rows}>
      {items.map((project) => (
        <article className={styles.recordRow} key={project.id}>
          <div className={styles.recordMain}>
            <strong>{project.name}</strong>
            <span>{project.description || 'No description'}</span>
          </div>
          <div className={styles.recordMeta}>
            <span>{project.owner.displayName}</span>
            <span>{project._count.memberships} members</span>
            <span>{project._count.items} items</span>
          </div>
          <span className={styles.statusActive}>Active</span>
        </article>
      ))}
    </div>
  );
}

export function UserRows({
  items,
  ownerId,
  onReset,
  onStatus,
  statusBusyUserId,
}: {
  items: InstanceUser[];
  ownerId: string;
  onReset: (user: InstanceUser) => void;
  onStatus: (user: InstanceUser) => void;
  statusBusyUserId?: string;
}) {
  return (
    <div className={styles.rows}>
      {items.map((user) => (
        <article className={`${styles.recordRow} ${styles.userRecordRow}`} key={user.id}>
          <div className={styles.recordMain}>
            <strong>
              {user.displayName}
              {user.id === ownerId ? <em>Instance owner</em> : null}
            </strong>
            <span>{user.email}</span>
            {user.company || user.department ? (
              <small>{[user.company, user.department].filter(Boolean).join(' · ')}</small>
            ) : null}
          </div>
          <div className={styles.recordMeta}>
            <span>{user._count.memberships} memberships</span>
            <span>{user._count.sessions} sessions</span>
            <span>Joined {new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
          <div className={styles.rowActions}>
            <span
              className={user.status === 'ACTIVE' ? styles.statusActive : styles.statusRetained}
            >
              {user.status.toLowerCase()}
            </span>
            <button type="button" className={styles.iconTextButton} onClick={() => onReset(user)}>
              <KeyIcon size={12} aria-hidden="true" />
              Reset password
            </button>
            {user.id !== ownerId ? (
              <button
                type="button"
                className={styles.iconTextButton}
                disabled={statusBusyUserId === user.id}
                onClick={() => onStatus(user)}
              >
                {statusBusyUserId === user.id
                  ? 'Updating…'
                  : user.status === 'ACTIVE'
                    ? 'Disable'
                    : 'Enable'}
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function StorageRows({ items }: { items: StorageItem[] }) {
  return (
    <div className={styles.rows}>
      {items.map((item) => (
        <article className={styles.recordRow} key={item.id}>
          <div className={styles.recordMain}>
            <strong>{item.originalFilename}</strong>
            <span>
              {item.project.name} · {item.mimeType}
            </span>
            {item.width && item.height ? (
              <small>
                {item.width} × {item.height}
                {item.durationMs ? ` · ${Math.round(item.durationMs / 1000)} sec` : ''}
              </small>
            ) : null}
          </div>
          <div className={styles.recordMeta}>
            <span>{item.kind.toLowerCase().replaceAll('_', ' ')}</span>
            <span>{bytes(item.sizeBytes)}</span>
            <span>{dateTime(item.createdAt)}</span>
          </div>
          <span className={item.deletedAt ? styles.statusRetained : styles.statusActive}>
            {item.deletedAt ? 'Retained' : item.status.toLowerCase()}
          </span>
        </article>
      ))}
    </div>
  );
}

const AUDIT_ROW_HEIGHT = 66;
const AUDIT_OVERSCAN = 5;

export function ActivityRows({
  items,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: ActivityEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const totalHeight = items.length * AUDIT_ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / AUDIT_ROW_HEIGHT) - AUDIT_OVERSCAN);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / AUDIT_ROW_HEIGHT) + AUDIT_OVERSCAN,
  );
  const visibleItems = items.slice(startIndex, endIndex);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setViewportHeight(container.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hasMore && !loadingMore && totalHeight <= viewportHeight + AUDIT_ROW_HEIGHT * 3) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore, totalHeight, viewportHeight]);

  const checkForNextPage = (nextScrollTop: number, clientHeight: number, scrollHeight: number) => {
    setScrollTop(nextScrollTop);
    if (hasMore && !loadingMore && scrollHeight - nextScrollTop - clientHeight < 240) {
      onLoadMore();
    }
  };

  return (
    <div
      ref={containerRef}
      className={styles.auditViewport}
      role="list"
      aria-label="Instance activity log"
      aria-live="off"
      tabIndex={0}
      onScroll={(event) => {
        const target = event.currentTarget;
        checkForNextPage(target.scrollTop, target.clientHeight, target.scrollHeight);
      }}
    >
      <div className={styles.auditCanvas} style={{ height: Math.max(totalHeight, viewportHeight) }}>
        <div
          className={styles.auditWindow}
          style={{ transform: `translateY(${startIndex * AUDIT_ROW_HEIGHT}px)` }}
        >
          {visibleItems.map((entry, offset) => {
            const metadata = metadataEntries(entry.metadata)
              .slice(0, 2)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ');
            return (
              <article
                className={styles.auditLogRow}
                key={entry.id}
                role="listitem"
                aria-posinset={startIndex + offset + 1}
                aria-setsize={hasMore ? -1 : items.length}
              >
                <div className={styles.auditAction}>
                  <p>
                    <strong>{entry.actor?.displayName ?? 'System'}</strong>{' '}
                    {entry.action.toLowerCase().replaceAll('_', ' ')}{' '}
                    <b>
                      {entry.resourceType
                        .toLowerCase()
                        .replaceAll('_', ' ')
                        .replaceAll('project', 'breakdown')}
                    </b>
                  </p>
                  <span>{metadata || `Resource ${entry.resourceId.slice(0, 8)}`}</span>
                </div>
                <span className={styles.auditProject}>{entry.project.name}</span>
                <time dateTime={entry.createdAt}>{dateTime(entry.createdAt)}</time>
              </article>
            );
          })}
        </div>
        {loadingMore ? (
          <div className={styles.auditLoadingMore} role="status">
            Loading older activity…
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function JobRows({ items }: { items: InstanceJob[] }) {
  if (!items.length) {
    return (
      <EmptyState icon={<PulseIcon size={22} />} title="No background jobs">
        This instance has no registered background jobs.
      </EmptyState>
    );
  }
  return (
    <div className={styles.sectionStack}>
      {items.map((job) => (
        <article className={styles.jobCard} key={job.id}>
          <header>
            <div>
              <span className={`${styles.jobDot} ${styles[`job_${job.state}`]}`} />
              <div>
                <h2>{job.name}</h2>
                <p>
                  {job.state} · every {duration(job.intervalSeconds)}
                </p>
              </div>
            </div>
            <strong>{job.lastPurgedProjects} breakdowns purged last run</strong>
          </header>
          <dl>
            <div>
              <dt>Last started</dt>
              <dd>{dateTime(job.lastStartedAt)}</dd>
            </div>
            <div>
              <dt>Last completed</dt>
              <dd>{dateTime(job.lastCompletedAt)}</dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>{dateTime(job.lastSucceededAt)}</dd>
            </div>
            <div>
              <dt>Next run</dt>
              <dd>{dateTime(job.nextRunAt)}</dd>
            </div>
          </dl>
          {job.lastFailureMessage ? (
            <p className={styles.formError}>{job.lastFailureMessage}</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function InvitationRows({
  items,
  onRevoke,
}: {
  items: InstanceInvitation[];
  onRevoke: (item: InstanceInvitation) => void;
}) {
  return (
    <div className={styles.rows}>
      {items.map((item) => {
        const available =
          item.status === 'PENDING' &&
          !item.revokedAt &&
          (!item.expiresAt || new Date(item.expiresAt) > new Date());
        const statusLabel = available
          ? item.isReusable
            ? 'active'
            : 'pending'
          : item.status.toLowerCase();
        return (
          <article className={styles.recordRow} key={item.id}>
            <div className={styles.recordMain}>
              <strong>{item.isReusable ? 'Reusable invitation' : item.email}</strong>
              <span>
                Created by {item.inviter.displayName} · {dateTime(item.createdAt)}
              </span>
              {item.project && item.role ? (
                <span>
                  Membership: {item.project.name} · {item.role.name}
                </span>
              ) : null}
              {item.isReusable ? <span>{item.redemptionCount} redemptions</span> : null}
            </div>
            <div className={styles.recordMeta}>
              <span>
                {item.expiresAt ? `Expires ${dateTime(item.expiresAt)}` : 'Never expires'}
              </span>
              {item.acceptedBy ? <span>Accepted by {item.acceptedBy.displayName}</span> : null}
            </div>
            <div className={styles.rowActions}>
              <span className={available ? styles.statusActive : styles.statusRetained}>
                {statusLabel}
              </span>
              {available ? (
                <button
                  type="button"
                  className={styles.iconTextButton}
                  onClick={() => onRevoke(item)}
                >
                  <TrashIcon size={12} aria-hidden="true" />
                  Revoke
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
