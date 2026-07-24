import type { AccountPage } from './account-validation';
import type { AdminPage } from './admin/types';
import type { InstanceSettingsSection } from './instance-settings/types';

const adminPages = new Set<AdminPage>([
  'overview',
  'projects',
  'users',
  'storage',
  'jobs',
  'audit',
  'invitations',
]);

const instanceSettingsSections = new Set<InstanceSettingsSection>([
  'general',
  'storage',
  'backups',
  'updates',
  'doctor',
]);

const instanceSettingsPrefix = '/admin/settings';

const workspacePattern = /^\/breakdowns\/([0-9a-f-]+)$/i;
const managementPattern = /^\/breakdowns\/([0-9a-f-]+)\/manage$/i;
const screenplayPattern = /^\/screenplays\/([0-9a-f-]+)$/i;

export function workspaceProjectId(route: string): string | undefined {
  return route.match(workspacePattern)?.[1];
}

export function managementProjectId(route: string): string | undefined {
  return route.match(managementPattern)?.[1];
}

export function screenplayIdFromRoute(route: string): string | undefined {
  return route.match(screenplayPattern)?.[1];
}

export function accountPageFromRoute(route: string): AccountPage {
  if (route === '/account/developer') return 'developer';
  if (route === '/account/security') return 'security';
  if (route === '/account/preferences') return 'preferences';
  return 'profile';
}

export function adminPageFromRoute(route: string): AdminPage {
  const segment = route.startsWith('/admin/') ? route.slice('/admin/'.length) : 'overview';
  return adminPages.has(segment as AdminPage) ? (segment as AdminPage) : 'overview';
}

export function isAccountRoute(route: string): boolean {
  return route === '/account' || route.startsWith('/account/');
}

export function isAdminRoute(route: string): boolean {
  return route === '/admin' || route.startsWith('/admin/');
}

export function isInstanceSettingsRoute(route: string): boolean {
  return route === instanceSettingsPrefix || route.startsWith(`${instanceSettingsPrefix}/`);
}

export function instanceSettingsSectionFromRoute(route: string): InstanceSettingsSection {
  const segment = route.startsWith(`${instanceSettingsPrefix}/`)
    ? route.slice(`${instanceSettingsPrefix}/`.length)
    : 'general';
  return instanceSettingsSections.has(segment as InstanceSettingsSection)
    ? (segment as InstanceSettingsSection)
    : 'general';
}

export function instanceSettingsSectionPath(section: InstanceSettingsSection): string {
  return section === 'general' ? instanceSettingsPrefix : `${instanceSettingsPrefix}/${section}`;
}
