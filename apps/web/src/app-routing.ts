import type { AccountPage } from './account-validation';
import type { AdminPage } from './admin/types';

const adminPages = new Set<AdminPage>([
  'overview',
  'projects',
  'users',
  'storage',
  'jobs',
  'audit',
  'invitations',
]);

const workspacePattern = /^\/projects\/([0-9a-f-]+)$/i;
const managementPattern = /^\/projects\/([0-9a-f-]+)\/manage$/i;

export function workspaceProjectId(route: string): string | undefined {
  return route.match(workspacePattern)?.[1];
}

export function managementProjectId(route: string): string | undefined {
  return route.match(managementPattern)?.[1];
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
