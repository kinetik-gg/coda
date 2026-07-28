import { ArchiveIcon } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { DatabaseIcon } from '@phosphor-icons/react/dist/csr/Database';
import { DevicesIcon } from '@phosphor-icons/react/dist/csr/Devices';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/dist/csr/EnvelopeSimple';
import { GaugeIcon } from '@phosphor-icons/react/dist/csr/Gauge';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { StethoscopeIcon } from '@phosphor-icons/react/dist/csr/Stethoscope';
import { TreeStructureIcon } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UserCircleIcon } from '@phosphor-icons/react/dist/csr/UserCircle';
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users';
import {
  instanceSettingsSectionPath,
  isAccountRoute,
  isAdminRoute,
  isInstanceSettingsRoute,
  instanceSettingsSectionFromRoute,
} from '../app-routing';
import { webResourceTypes, type ResourceTypeIcon } from '../spaces/resource-types';

export type RailIcon = ResourceTypeIcon;

export interface RailItem {
  id: string;
  /** Label shown on the rail button. */
  label: string;
  icon: RailIcon;
  path: string;
  isActive: (route: string) => boolean;
  /**
   * Breadcrumb trail for the page header. The last crumb is the page heading; earlier crumbs
   * render as the muted breadcrumb prefix. Declared here so the nav model is the single source of
   * truth for both navigation and page headers.
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

/**
 * Screenplays, Breakdowns, Trash — the daily-use library, and the only group the rail's static nav
 * rows still render (see `DashboardRail`). Everything below used to sit beside it; #163 moved
 * Account and Administration behind the rail's Settings entry so the rail's scarce rows go to the
 * surfaces actually touched daily.
 */
export const libraryGroup: RailGroup = {
  id: 'library',
  label: 'Library',
  items: [
    ...webResourceTypes.map((resourceType) => ({
      id: resourceType.id,
      label: resourceType.label,
      icon: resourceType.icon,
      path: resourceType.listRoute,
      isActive: (route: string) =>
        route === resourceType.listRoute || (resourceType.id === 'screenplay' && route === '/'),
      crumbs: ['Library', resourceType.label],
    })),
    {
      id: 'trash',
      label: 'Trash',
      icon: TrashIcon,
      path: '/trash',
      isActive: exact('/trash'),
      crumbs: ['Library', 'Trash'],
    },
  ],
};

/**
 * Personal account pages, at their existing `/account*` routes. Reachable from the settings
 * surface's sub-nav (see `SettingsScreen`) rather than the rail directly.
 */
export const accountGroup: RailGroup = {
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
      isActive: exact('/account/preferences'),
      crumbs: ['Account', 'Preferences'],
    },
    {
      id: 'security',
      label: 'Security',
      icon: LockKeyIcon,
      path: '/account/security',
      isActive: exact('/account/security'),
      crumbs: ['Account', 'Security'],
    },
    {
      id: 'sessions',
      label: 'Sessions',
      icon: DevicesIcon,
      path: '/account/sessions',
      isActive: exact('/account/sessions'),
      crumbs: ['Account', 'Sessions'],
    },
    {
      id: 'developer',
      label: 'Developer',
      icon: KeyIcon,
      path: '/account/developer',
      isActive: exact('/account/developer'),
      crumbs: ['Account', 'Developer'],
    },
  ],
};

/**
 * Instance administration pages — `/admin*`, excluding the Instance Settings sub-tree below.
 * Reachable only from the settings surface's Administration section.
 */
export const administrationGroup: RailGroup = {
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
      icon: TreeStructureIcon,
      path: '/admin/projects',
      isActive: exact('/admin/projects'),
      crumbs: ['Administration', 'Breakdowns'],
    },
    {
      id: 'admin-users',
      label: 'Users',
      icon: UsersIcon,
      path: '/admin/users',
      isActive: exact('/admin/users'),
      crumbs: ['Administration', 'Users'],
    },
    {
      id: 'admin-storage',
      label: 'Storage',
      icon: DatabaseIcon,
      path: '/admin/storage',
      isActive: exact('/admin/storage'),
      crumbs: ['Administration', 'Storage'],
    },
    {
      id: 'admin-jobs',
      label: 'Jobs',
      icon: GaugeIcon,
      path: '/admin/jobs',
      isActive: exact('/admin/jobs'),
      crumbs: ['Administration', 'Jobs'],
    },
    {
      id: 'admin-audit',
      label: 'Audit',
      icon: ClipboardTextIcon,
      path: '/admin/audit',
      isActive: exact('/admin/audit'),
      crumbs: ['Administration', 'Audit'],
    },
    {
      id: 'admin-invitations',
      label: 'Invitations',
      icon: EnvelopeSimpleIcon,
      path: '/admin/invitations',
      isActive: exact('/admin/invitations'),
      crumbs: ['Administration', 'Invitations'],
    },
  ],
};

/**
 * Instance-wide configuration — `/admin/settings*`. A sibling of Administration rather than a
 * nested list within it: both render one level under the settings surface's Administration tab,
 * distinguished by a section heading instead of the `Settings:` label prefix #163 removed.
 */
export const instanceSettingsGroup: RailGroup = {
  id: 'instance-settings',
  label: 'Instance Settings',
  adminOnly: true,
  items: [
    {
      id: 'settings-general',
      label: 'General',
      icon: GearSixIcon,
      path: instanceSettingsSectionPath('general'),
      isActive: settingsSection('general'),
      crumbs: ['Administration', 'Instance Settings', 'General'],
    },
    {
      id: 'settings-storage',
      label: 'Storage',
      icon: HardDrivesIcon,
      path: instanceSettingsSectionPath('storage'),
      isActive: settingsSection('storage'),
      crumbs: ['Administration', 'Instance Settings', 'Storage'],
    },
    {
      id: 'settings-backups',
      label: 'Backups',
      icon: ArchiveIcon,
      path: instanceSettingsSectionPath('backups'),
      isActive: settingsSection('backups'),
      crumbs: ['Administration', 'Instance Settings', 'Backups'],
    },
    {
      id: 'settings-updates',
      label: 'Updates',
      icon: ArrowsClockwiseIcon,
      path: instanceSettingsSectionPath('updates'),
      isActive: settingsSection('updates'),
      crumbs: ['Administration', 'Instance Settings', 'Updates'],
    },
    {
      id: 'settings-doctor',
      label: 'Doctor',
      icon: StethoscopeIcon,
      path: instanceSettingsSectionPath('doctor'),
      isActive: settingsSection('doctor'),
      crumbs: ['Administration', 'Instance Settings', 'Doctor'],
    },
  ],
};

/**
 * Every navigable group, in a stable order. The single source for breadcrumbs
 * (`resolveRailCrumbs`) and for the command palette / Go menu's navigation commands
 * (`dashboard-commands.ts`) — a superset of what any one surface renders, so a route never loses
 * its crumb or its ⌘K entry just because #163 moved it off the physical rail.
 */
export const navGroups: readonly RailGroup[] = [
  libraryGroup,
  accountGroup,
  administrationGroup,
  instanceSettingsGroup,
];

/**
 * Groups the dashboard rail renders directly (see `DashboardRail`). Account, Administration, and
 * Instance Settings moved behind the rail's Settings entry — see `settingsGroups`.
 */
export const railGroups: readonly RailGroup[] = [libraryGroup];

/** Groups the settings surface's two-level sub-nav renders (see `SettingsScreen`). */
export const settingsGroups: readonly RailGroup[] = [
  accountGroup,
  administrationGroup,
  instanceSettingsGroup,
];

/**
 * The rail's footer entry point into the settings surface — current for the whole of Account,
 * Administration, and Instance Settings, since the settings sub-nav (not the rail) resolves which
 * page within it is current.
 */
export const settingsRailEntry: RailItem = {
  id: 'settings',
  label: 'Settings',
  icon: GearSixIcon,
  path: '/account',
  isActive: (route) => isAccountRoute(route) || isAdminRoute(route),
  crumbs: ['Account', 'Profile'],
};

/**
 * Resolves the breadcrumb trail for a route from the nav declarations — the single source of truth
 * so page headers never drift from navigation. Returns the matched item's crumbs, or a single-crumb
 * fallback when no item matches.
 */
export function resolveRailCrumbs(route: string): readonly string[] {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.isActive(route)) return item.crumbs;
    }
  }
  return ['Coda'];
}
