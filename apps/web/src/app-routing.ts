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
/**
 * Breakdown management. `/manage` is the URL that shipped and must keep resolving (#169), so it
 * stays the address of the share modal — the members/roles overview it always landed on — and
 * `/manage/share` addresses the same thing explicitly. Both open the breakdowns *library* with
 * that breakdown's share modal presented, the exact analogue of `/screenplays/:id/manage` (#176);
 * nothing management-shaped renders underneath. `/manage/structure` addresses the
 * entity-and-field editor, which is a genuine full-surface tool rather than a focused task, and
 * stays a page.
 */
const managementPattern = /^\/breakdowns\/([0-9a-f-]+)\/manage(?:\/(share|structure))?$/i;
const screenplayPattern = /^\/screenplays\/([0-9a-f-]+)$/i;
const screenplayManagementPattern = /^\/screenplays\/([0-9a-f-]+)\/manage$/i;

/** Which breakdown-management surface a route addresses. `share` is the modal, and the default. */
export type ProjectManagementSection = 'share' | 'structure';

export function workspaceProjectId(route: string): string | undefined {
  return route.match(workspacePattern)?.[1];
}

export function managementProjectId(route: string): string | undefined {
  return route.match(managementPattern)?.[1];
}

export function projectManagementSection(route: string): ProjectManagementSection {
  return route.match(managementPattern)?.[2] === 'structure' ? 'structure' : 'share';
}

export function projectManagementPath(
  projectId: string,
  section: ProjectManagementSection = 'share',
): string {
  return section === 'share'
    ? `/breakdowns/${projectId}/manage`
    : `/breakdowns/${projectId}/manage/structure`;
}

export function screenplaySharePath(screenplayId: string): string {
  return `/screenplays/${screenplayId}/manage`;
}

export function screenplayIdFromRoute(route: string): string | undefined {
  return route.match(screenplayPattern)?.[1];
}

export function screenplayManagementId(route: string): string | undefined {
  return route.match(screenplayManagementPattern)?.[1];
}

export function accountPageFromRoute(route: string): AccountPage {
  if (route === '/account/developer') return 'developer';
  if (route === '/account/sessions') return 'sessions';
  if (route === '/account/security') return 'security';
  if (route === '/account/preferences') return 'preferences';
  return 'profile';
}

export function adminPageFromRoute(route: string): AdminPage {
  const segment = route.startsWith('/admin/') ? route.slice('/admin/'.length) : 'overview';
  return adminPages.has(segment as AdminPage) ? (segment as AdminPage) : 'overview';
}

export function accountPagePath(page: AccountPage): string {
  return page === 'profile' ? '/account' : `/account/${page}`;
}

export function adminPagePath(page: AdminPage): string {
  return page === 'overview' ? '/admin' : `/admin/${page}`;
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
