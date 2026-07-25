import { type ComponentType } from 'react';
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

export type RailIcon = ComponentType<{
  size?: number;
  weight?: 'regular' | 'fill';
  'aria-hidden'?: boolean;
}>;

export interface RailItem {
  id: string;
  /** Label shown on the rail button. */
  label: string;
  icon: RailIcon;
  path: string;
  sub?: boolean;
  isActive: (route: string) => boolean;
  /**
   * Breadcrumb trail for the page header. The last crumb is the page heading;
   * earlier crumbs render as the muted breadcrumb prefix. Declared here so the
   * rail is the single source of truth for both navigation and page headers.
   */
  crumbs: readonly string[];
}

export interface RailGroup {
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

export const railGroups: readonly RailGroup[] = [
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
        crumbs: ['Library', 'Screenplays'],
      },
      {
        id: 'breakdowns',
        label: 'Breakdowns',
        icon: FolderOpenIcon,
        path: '/breakdowns',
        isActive: exact('/breakdowns'),
        crumbs: ['Library', 'Breakdowns'],
      },
      {
        id: 'trash',
        label: 'Trash',
        icon: TrashIcon,
        path: '/trash',
        isActive: exact('/trash'),
        crumbs: ['Library', 'Trash'],
      },
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
        crumbs: ['Account', 'Profile'],
      },
      {
        id: 'preferences',
        label: 'Preferences',
        icon: SlidersHorizontalIcon,
        path: '/account/preferences',
        sub: true,
        isActive: exact('/account/preferences'),
        crumbs: ['Account', 'Preferences'],
      },
      {
        id: 'security',
        label: 'Security',
        icon: LockKeyIcon,
        path: '/account/security',
        sub: true,
        isActive: exact('/account/security'),
        crumbs: ['Account', 'Security'],
      },
      {
        id: 'sessions',
        label: 'Sessions',
        icon: DevicesIcon,
        path: '/account/sessions',
        sub: true,
        isActive: exact('/account/sessions'),
        crumbs: ['Account', 'Sessions'],
      },
      {
        id: 'developer',
        label: 'Developer',
        icon: KeyIcon,
        path: '/account/developer',
        sub: true,
        isActive: exact('/account/developer'),
        crumbs: ['Account', 'Developer'],
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
        crumbs: ['Administration', 'Overview'],
      },
      {
        id: 'admin-breakdowns',
        label: 'Breakdowns',
        icon: FolderOpenIcon,
        path: '/admin/projects',
        sub: true,
        isActive: exact('/admin/projects'),
        crumbs: ['Administration', 'Breakdowns'],
      },
      {
        id: 'admin-users',
        label: 'Users',
        icon: UsersIcon,
        path: '/admin/users',
        sub: true,
        isActive: exact('/admin/users'),
        crumbs: ['Administration', 'Users'],
      },
      {
        id: 'admin-storage',
        label: 'Storage',
        icon: DatabaseIcon,
        path: '/admin/storage',
        sub: true,
        isActive: exact('/admin/storage'),
        crumbs: ['Administration', 'Storage'],
      },
      {
        id: 'admin-jobs',
        label: 'Jobs',
        icon: GaugeIcon,
        path: '/admin/jobs',
        sub: true,
        isActive: exact('/admin/jobs'),
        crumbs: ['Administration', 'Jobs'],
      },
      {
        id: 'admin-audit',
        label: 'Audit',
        icon: ClipboardTextIcon,
        path: '/admin/audit',
        sub: true,
        isActive: exact('/admin/audit'),
        crumbs: ['Administration', 'Audit'],
      },
      {
        id: 'admin-invitations',
        label: 'Invitations',
        icon: EnvelopeSimpleIcon,
        path: '/admin/invitations',
        sub: true,
        isActive: exact('/admin/invitations'),
        crumbs: ['Administration', 'Invitations'],
      },
      {
        id: 'settings-general',
        label: 'Settings: General',
        icon: GearSixIcon,
        path: instanceSettingsSectionPath('general'),
        sub: true,
        isActive: settingsSection('general'),
        crumbs: ['Administration', 'Instance Settings', 'General'],
      },
      {
        id: 'settings-storage',
        label: 'Settings: Storage',
        icon: HardDrivesIcon,
        path: instanceSettingsSectionPath('storage'),
        sub: true,
        isActive: settingsSection('storage'),
        crumbs: ['Administration', 'Instance Settings', 'Storage'],
      },
      {
        id: 'settings-backups',
        label: 'Settings: Backups',
        icon: ArchiveIcon,
        path: instanceSettingsSectionPath('backups'),
        sub: true,
        isActive: settingsSection('backups'),
        crumbs: ['Administration', 'Instance Settings', 'Backups'],
      },
      {
        id: 'settings-updates',
        label: 'Settings: Updates',
        icon: ArrowsClockwiseIcon,
        path: instanceSettingsSectionPath('updates'),
        sub: true,
        isActive: settingsSection('updates'),
        crumbs: ['Administration', 'Instance Settings', 'Updates'],
      },
      {
        id: 'settings-doctor',
        label: 'Settings: Doctor',
        icon: StethoscopeIcon,
        path: instanceSettingsSectionPath('doctor'),
        sub: true,
        isActive: settingsSection('doctor'),
        crumbs: ['Administration', 'Instance Settings', 'Doctor'],
      },
    ],
  },
];

/**
 * Resolves the breadcrumb trail for a route from the rail declarations — the
 * single source of truth so page headers never drift from the rail. Returns
 * the matched item's crumbs, or a single-crumb fallback when no item matches.
 */
export function resolveRailCrumbs(route: string): readonly string[] {
  for (const group of railGroups) {
    for (const item of group.items) {
      if (item.isActive(route)) return item.crumbs;
    }
  }
  return ['Coda'];
}
