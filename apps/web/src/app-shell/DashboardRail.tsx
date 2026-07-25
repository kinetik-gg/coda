import { useCallback, type ComponentType, type KeyboardEvent } from 'react';
import { ArchiveIcon } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { DatabaseIcon } from '@phosphor-icons/react/dist/csr/Database';
import { DevicesIcon } from '@phosphor-icons/react/dist/csr/Devices';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/dist/csr/EnvelopeSimple';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GaugeIcon } from '@phosphor-icons/react/dist/csr/Gauge';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey';
import { SidebarSimpleIcon } from '@phosphor-icons/react/dist/csr/SidebarSimple';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { StethoscopeIcon } from '@phosphor-icons/react/dist/csr/Stethoscope';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UserCircleIcon } from '@phosphor-icons/react/dist/csr/UserCircle';
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users';
import {
  instanceSettingsSectionPath,
  isInstanceSettingsRoute,
  instanceSettingsSectionFromRoute,
} from '../app-routing';
import styles from './DashboardShell.module.css';

type RailIcon = ComponentType<{
  size?: number;
  weight?: 'regular' | 'fill';
  'aria-hidden'?: boolean;
}>;

interface RailItem {
  id: string;
  label: string;
  icon: RailIcon;
  path: string;
  sub?: boolean;
  isActive: (route: string) => boolean;
}

interface RailGroup {
  id: string;
  label: string;
  adminOnly?: boolean;
  items: readonly RailItem[];
}

const exact =
  (path: string) =>
  (route: string): boolean =>
    route === path;

const settingsSection =
  (section: ReturnType<typeof instanceSettingsSectionFromRoute>) =>
  (route: string): boolean =>
    isInstanceSettingsRoute(route) && instanceSettingsSectionFromRoute(route) === section;

const GROUPS: readonly RailGroup[] = [
  {
    id: 'library',
    label: 'Library',
    items: [
      {
        id: 'screenplays',
        label: 'Screenplays',
        icon: BookOpenTextIcon,
        path: '/',
        isActive: (route) => route === '/' || route === '/screenplays',
      },
      {
        id: 'breakdowns',
        label: 'Breakdowns',
        icon: FolderOpenIcon,
        path: '/breakdowns',
        isActive: exact('/breakdowns'),
      },
      { id: 'trash', label: 'Trash', icon: TrashIcon, path: '/trash', isActive: exact('/trash') },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      {
        id: 'profile',
        label: 'Profile',
        icon: UserCircleIcon,
        path: '/account',
        isActive: exact('/account'),
      },
      {
        id: 'preferences',
        label: 'Preferences',
        icon: SlidersHorizontalIcon,
        path: '/account/preferences',
        sub: true,
        isActive: exact('/account/preferences'),
      },
      {
        id: 'security',
        label: 'Security',
        icon: LockKeyIcon,
        path: '/account/security',
        sub: true,
        isActive: exact('/account/security'),
      },
      {
        id: 'sessions',
        label: 'Sessions',
        icon: DevicesIcon,
        path: '/account/sessions',
        sub: true,
        isActive: exact('/account/sessions'),
      },
      {
        id: 'developer',
        label: 'Developer',
        icon: KeyIcon,
        path: '/account/developer',
        sub: true,
        isActive: exact('/account/developer'),
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    adminOnly: true,
    items: [
      {
        id: 'instance',
        label: 'Instance',
        icon: BuildingsIcon,
        path: '/admin',
        isActive: exact('/admin'),
      },
      {
        id: 'admin-breakdowns',
        label: 'Breakdowns',
        icon: FolderOpenIcon,
        path: '/admin/projects',
        sub: true,
        isActive: exact('/admin/projects'),
      },
      {
        id: 'admin-users',
        label: 'Users',
        icon: UsersIcon,
        path: '/admin/users',
        sub: true,
        isActive: exact('/admin/users'),
      },
      {
        id: 'admin-storage',
        label: 'Storage',
        icon: DatabaseIcon,
        path: '/admin/storage',
        sub: true,
        isActive: exact('/admin/storage'),
      },
      {
        id: 'admin-jobs',
        label: 'Jobs',
        icon: GaugeIcon,
        path: '/admin/jobs',
        sub: true,
        isActive: exact('/admin/jobs'),
      },
      {
        id: 'admin-audit',
        label: 'Audit',
        icon: ClipboardTextIcon,
        path: '/admin/audit',
        sub: true,
        isActive: exact('/admin/audit'),
      },
      {
        id: 'admin-invitations',
        label: 'Invitations',
        icon: EnvelopeSimpleIcon,
        path: '/admin/invitations',
        sub: true,
        isActive: exact('/admin/invitations'),
      },
      {
        id: 'settings-general',
        label: 'Settings: General',
        icon: GearSixIcon,
        path: instanceSettingsSectionPath('general'),
        sub: true,
        isActive: settingsSection('general'),
      },
      {
        id: 'settings-storage',
        label: 'Settings: Storage',
        icon: HardDrivesIcon,
        path: instanceSettingsSectionPath('storage'),
        sub: true,
        isActive: settingsSection('storage'),
      },
      {
        id: 'settings-backups',
        label: 'Settings: Backups',
        icon: ArchiveIcon,
        path: instanceSettingsSectionPath('backups'),
        sub: true,
        isActive: settingsSection('backups'),
      },
      {
        id: 'settings-updates',
        label: 'Settings: Updates',
        icon: ArrowsClockwiseIcon,
        path: instanceSettingsSectionPath('updates'),
        sub: true,
        isActive: settingsSection('updates'),
      },
      {
        id: 'settings-doctor',
        label: 'Settings: Doctor',
        icon: StethoscopeIcon,
        path: instanceSettingsSectionPath('doctor'),
        sub: true,
        isActive: settingsSection('doctor'),
      },
    ],
  },
];

function RailButton({
  item,
  route,
  onNavigate,
}: {
  item: RailItem;
  route: string;
  onNavigate: (path: string) => void;
}) {
  const Icon = item.icon;
  const active = item.isActive(route);
  return (
    <button
      type="button"
      data-rail-item
      className={`${styles.railItem} ${item.sub ? styles.railItemSub : ''}`}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      onClick={() => onNavigate(item.path)}
    >
      <Icon size={12} aria-hidden />
      <span className={styles.railItemLabel}>{item.label}</span>
    </button>
  );
}

/**
 * The dense navigation rail. Groups mirror the surfaces the shell hosts
 * (library / account / administration); the instance-settings sections are
 * flattened as administration sub-items. Every item is a real button, so the
 * rail is reachable by Tab, and arrow keys rove focus within it for parity
 * with the editors' keyboard-first chrome. Hover and keyboard focus resolve to
 * the same visual state through `:focus-visible`.
 */
export function DashboardRail({
  route,
  isAdministrator,
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: {
  route: string;
  isAdministrator: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (path: string) => void;
}) {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const container = event.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-rail-item]'));
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }, []);

  const groups = GROUPS.filter((group) => !group.adminOnly || isAdministrator);
  return (
    <aside className={`${styles.rail} ${collapsed ? styles.railCollapsed : ''}`}>
      <div className={styles.railTop}>
        <button
          type="button"
          className={styles.railToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
        >
          <SidebarSimpleIcon size={12} aria-hidden />
        </button>
      </div>
      <nav className={styles.railNav} aria-label="Coda pages" onKeyDown={handleKeyDown}>
        {groups.map((group) => (
          <div key={group.id} className={styles.railGroup}>
            <span className={styles.railGroupLabel} aria-hidden={collapsed}>
              {group.label}
            </span>
            {group.items.map((item) => (
              <RailButton key={item.id} item={item} route={route} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
      <footer className={styles.railFooter}>© Kinetik Coda</footer>
    </aside>
  );
}
