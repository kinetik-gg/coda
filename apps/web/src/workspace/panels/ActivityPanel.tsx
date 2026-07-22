import { useQuery } from '@tanstack/react-query';
import type { WorkspacePanel } from '@coda/contracts';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { api } from '../../api';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import type { PanelContentProps } from './types';
import styles from './Panels.styles';

type Activity = Extract<WorkspacePanel, { type: 'activity' }>;
interface ActivityEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  actor?: { id: string; displayName: string } | null;
}

function safeDetails(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`);
}

export function ActivityPanel({ projectId, panel }: PanelContentProps & { panel: Activity }) {
  const activity = useQuery({
    queryKey: ['activity', projectId],
    queryFn: ({ signal }) =>
      api<ActivityEvent[]>(`/api/v1/projects/${projectId}/activity`, { signal }),
    refetchInterval: 30_000,
  });
  const needle = panel.config.search.trim().toLowerCase();
  const events = (activity.data ?? []).filter(
    (event) =>
      !needle ||
      [
        event.action,
        event.resourceType,
        event.actor?.displayName,
        ...safeDetails(event.metadata),
      ].some((value) => value?.toLowerCase().includes(needle)),
  );
  return (
    <div className={styles.utilityPanel} aria-busy={activity.isLoading}>
      <div className={styles.utilityList}>
        {activity.isLoading && (
          <SkeletonGroup label="Loading project activity" className={styles.utilityListSkeleton}>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index}>
                <Skeleton width={12} height={12} />
                <span>
                  <Skeleton width={index % 3 === 0 ? '88%' : '72%'} height={9} />
                  <Skeleton width={112} height={8} />
                  <Skeleton width="44%" height={8} />
                </span>
              </div>
            ))}
          </SkeletonGroup>
        )}
        {!activity.isLoading && activity.error && (
          <div className={styles.panelQueryState} role="alert">
            <span>Activity could not be loaded.</span>
            <button
              type="button"
              className={styles.queryStateAction}
              onClick={() => void activity.refetch()}
            >
              Retry
            </button>
          </div>
        )}
        {!activity.isLoading &&
          !activity.error &&
          events.map((event) => (
            <article key={event.id} className={styles.activityEntry}>
              <ClockCounterClockwiseIcon size={12} aria-hidden="true" />
              <div>
                <p>
                  <strong>{event.actor?.displayName ?? 'System'}</strong>{' '}
                  {event.action.toLowerCase().replaceAll('_', ' ')}{' '}
                  {event.resourceType.replaceAll('_', ' ')}
                </p>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                {safeDetails(event.metadata).length > 0 && (
                  <dl>
                    {safeDetails(event.metadata).map((detail) => (
                      <div key={detail}>
                        <dd>{detail}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </article>
          ))}
        {!activity.isLoading && !activity.error && events.length === 0 && (
          <div className={styles.empty}>No activity matches this view.</div>
        )}
      </div>
    </div>
  );
}
