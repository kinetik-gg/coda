import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../components/DropdownMenu';
import { StatusBar, StatusBarSegment } from '../workspace/shell';
import appStyles from '../App.styles';
import { useMenuBar } from './menu-bar/use-menu-bar';
import styles from './DashboardShell.module.css';

type InstanceHealth = 'healthy' | 'issues' | 'unknown';

interface DoctorReportLike {
  rows: { status: 'ok' | 'warn' | 'error' | 'unknown' }[];
}

/**
 * Reads overall instance health from the shared doctor endpoint (the same
 * source the settings Doctor section renders in detail). Any failing check
 * degrades the summary to `issues`; an unreachable or still-loading report is
 * reported as `unknown` rather than a false positive.
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

function HealthChip({ health }: { health: InstanceHealth }) {
  return (
    <span className={styles.chip} title={`Instance status: ${HEALTH_LABEL[health]}`}>
      <span className={`${styles.dot} ${HEALTH_DOT[health]}`} aria-hidden />
      <span>{HEALTH_LABEL[health]}</span>
    </span>
  );
}

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
 * The masthead trailing cluster: update chip, instance-health chip, and the
 * bordered user menu — the exact left-to-right order of the design spec. The
 * user menu reuses the menu-bar controller for full keyboard navigation.
 */
export function DashboardMastheadTrailing({
  health,
  updateAvailable,
  displayName,
  onNavigate,
  onLogout,
}: {
  health: InstanceHealth;
  updateAvailable: boolean;
  displayName?: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  return (
    <>
      <UpdateChip updateAvailable={updateAvailable} />
      <HealthChip health={health} />
      <UserMenu displayName={displayName} onNavigate={onNavigate} onLogout={onLogout} />
    </>
  );
}

/** The dashboard status bar, built on the shared StatusBar framework. */
export function DashboardStatusBar({
  version,
  health,
}: {
  version: string;
  health: InstanceHealth;
}) {
  return (
    <StatusBar
      className={styles.statusBar}
      left={
        <>
          <StatusBarSegment>CODA V{version}</StatusBarSegment>
          <StatusBarSegment
            icon={<span className={`${styles.dot} ${HEALTH_DOT[health]}`} aria-hidden />}
          >
            {HEALTH_LABEL[health]}
          </StatusBarSegment>
        </>
      }
      right={<StatusBarSegment>Ready</StatusBarSegment>}
    />
  );
}
