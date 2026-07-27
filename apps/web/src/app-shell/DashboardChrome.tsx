import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bytes } from '../admin/utils';
import type { InstanceManagementSummary } from '../admin/types';
import { api } from '../api';
import { StatusBar, StatusBarSegment } from '../workspace/shell';
import type { LibraryTarget } from './library-target';
import styles from './DashboardShell.module.css';

type InstanceHealth = 'healthy' | 'issues' | 'unknown';

interface DoctorReportLike {
  rows: { status: 'ok' | 'warn' | 'error' | 'unknown' }[];
}

/**
 * Reads overall instance health from the shared doctor endpoint (the same source the settings
 * Doctor section renders in detail). Any failing check degrades the summary to `issues`; an
 * unreachable or still-loading report is reported as `unknown` rather than a false positive.
 */
export function useInstanceHealth(): InstanceHealth {
  const query = useQuery({
    queryKey: ['instance-doctor'],
    queryFn: () => api<DoctorReportLike>('/api/v1/instance/doctor'),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  if (!query.data) return 'unknown';
  return query.data.rows.some((row) => row.status === 'error') ? 'issues' : 'healthy';
}

/**
 * Storage consumed by this instance, from the same management summary the Admin ▸ Storage page
 * renders in full. The endpoint is administrator-only, so the query never fires for anyone else —
 * a regular user's status bar simply omits the segment rather than eating a guaranteed 403.
 */
export function useInstanceStorage(isAdministrator: boolean): string | undefined {
  const query = useQuery({
    queryKey: ['instance-management'],
    queryFn: () => api<InstanceManagementSummary>('/api/v1/instance/management'),
    enabled: isAdministrator,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  if (!query.data) return undefined;
  return bytes(query.data.counts.storageBytes);
}

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Live reachability of the instance from this client — the sync signal a library surface needs. */
export function useConnected(): boolean {
  return useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    () => true,
  );
}

const HEALTH_LABEL: Record<InstanceHealth, string> = {
  healthy: 'Healthy',
  issues: 'Issues',
  unknown: 'Checking',
};

const HEALTH_DOT: Record<InstanceHealth, string | undefined> = {
  healthy: styles.dotSuccess,
  issues: styles.dotDanger,
  unknown: styles.dotMuted,
};

/** The count of whatever the mounted surface holds — the dashboard's equivalent of a page count. */
function LibraryCountSegment({ library }: { library?: LibraryTarget }) {
  if (!library) return null;
  if (library.loading) return <StatusBarSegment>Loading…</StatusBarSegment>;
  const count = library.objects.length;
  return (
    <StatusBarSegment title={`${count} ${library.noun} in this instance`}>
      {count} {count === 1 ? library.singular : library.noun}
    </StatusBarSegment>
  );
}

/**
 * The dashboard status bar, built on the shared StatusBar framework and reporting the state a
 * library surface actually has: what this instance holds, how much storage that occupies, whether
 * the client can reach it, and the single canonical instance-health signal.
 */
export function DashboardStatusBar({
  version,
  health,
  connected,
  library,
  storage,
}: {
  version: string;
  health: InstanceHealth;
  connected: boolean;
  library?: LibraryTarget;
  /** Storage consumed by this instance; omitted entirely for non-administrators. */
  storage?: string;
}) {
  return (
    <StatusBar
      className={styles.statusBar}
      left={
        <>
          <StatusBarSegment preserveCase>CODA v{version}</StatusBarSegment>
          <LibraryCountSegment library={library} />
          {storage && (
            <StatusBarSegment title="Storage used by this instance">{storage}</StatusBarSegment>
          )}
        </>
      }
      right={
        <>
          <StatusBarSegment
            title={connected ? 'This client is online' : 'This client is offline'}
            icon={
              <span
                className={`${styles.dot} ${connected ? styles.dotSuccess : styles.dotDanger}`}
                aria-hidden
              />
            }
          >
            {connected ? 'Online' : 'Offline'}
          </StatusBarSegment>
          <StatusBarSegment
            title={`Instance status: ${HEALTH_LABEL[health]}`}
            icon={<span className={`${styles.dot} ${HEALTH_DOT[health]}`} aria-hidden />}
          >
            {HEALTH_LABEL[health]}
          </StatusBarSegment>
        </>
      }
    />
  );
}
