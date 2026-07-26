import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bytes } from '../admin/utils';
import type { InstanceManagementSummary } from '../admin/types';
import { api } from '../api';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../components/DropdownMenu';
import { StatusBar, StatusBarSegment } from '../workspace/shell';
import appStyles from '../App.styles';
import { CommandPaletteTrigger } from './CommandPalette';
import type { LibraryTarget } from './library-target';
import { useMenuBar } from './menu-bar/use-menu-bar';
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

/** The update-available chip only appears once an update is known to exist. */
function UpdateChip({ updateAvailable }: { updateAvailable: boolean }) {
  if (!updateAvailable) return null;
  return (
    <span className={styles.chip} title="An update is available">
      <span className={`${styles.dot} ${styles.dotFocus}`} aria-hidden />
      <span>Update</span>
    </span>
  );
}

function UserMenu({
  displayName,
  onNavigate,
  onLogout,
}: {
  displayName?: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  const controller = useMenuBar(['dashboard-user'], false);
  const open = controller.openMenuId === 'dashboard-user';
  const name = displayName ?? 'Account';
  return (
    <DropdownMenu
      id="dashboard-user"
      ariaLabel="Account menu"
      label={
        <>
          <span className={styles.avatarDot} aria-hidden />
          <span className={styles.userName}>{name}</span>
        </>
      }
      open={open}
      className={`${appStyles.accountMenu} ${styles.userMenu}`}
      triggerClassName={appStyles.menuTrigger}
      popupClassName={appStyles.appMenuPopup}
      align="end"
      rootRole="none"
      triggerRef={controller.registrars.trigger('dashboard-user')}
      popupRef={controller.registrars.popup('dashboard-user')}
      onToggle={() => controller.toggleMenu('dashboard-user')}
      onTriggerKeyDown={(event) => controller.handleTriggerKeyDown('dashboard-user', event)}
      onMenuKeyDown={(event) => controller.handleMenuKeyDown('dashboard-user', event)}
    >
      <span role="presentation" className={appStyles.accountName}>
        {name}
      </span>
      <DropdownMenuItem dismiss={controller.dismiss} onSelect={() => onNavigate('/account')}>
        Account settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem dismiss={controller.dismiss} onSelect={onLogout}>
        Sign out
      </DropdownMenuItem>
    </DropdownMenu>
  );
}

/**
 * The masthead trailing cluster: the update affordance, the command-palette entry point, and the
 * bordered user menu. Instance health is deliberately absent — it is ambient state and belongs in
 * the status bar, reported exactly once (issue #165). Only a *change* in state earns masthead
 * salience, which is what the update chip is.
 */
export function DashboardMastheadTrailing({
  updateAvailable,
  displayName,
  onOpenPalette,
  onNavigate,
  onLogout,
}: {
  updateAvailable: boolean;
  displayName?: string;
  onOpenPalette: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  return (
    <>
      <UpdateChip updateAvailable={updateAvailable} />
      <CommandPaletteTrigger onOpen={onOpenPalette} />
      <UserMenu displayName={displayName} onNavigate={onNavigate} onLogout={onLogout} />
    </>
  );
}

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
          <StatusBarSegment>CODA V{version}</StatusBarSegment>
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
