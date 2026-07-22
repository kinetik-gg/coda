import { describe, expect, it } from 'vitest';
import {
  accountPageFromRoute,
  adminPageFromRoute,
  isAccountRoute,
  isAdminRoute,
  managementProjectId,
  workspaceProjectId,
} from './app-routing';

describe('application routing', () => {
  it('recognizes workspace and management project routes without accepting suffixes', () => {
    expect(workspaceProjectId('/projects/a0b1-c2d3')).toBe('a0b1-c2d3');
    expect(workspaceProjectId('/projects/A0B1')).toBe('A0B1');
    expect(workspaceProjectId('/projects/a0b1/manage')).toBeUndefined();
    expect(workspaceProjectId('/projects/not-a-uuid!')).toBeUndefined();
    expect(managementProjectId('/projects/a0b1/manage')).toBe('a0b1');
    expect(managementProjectId('/projects/a0b1/manage/more')).toBeUndefined();
  });

  it.each([
    ['/account', 'profile'],
    ['/account/preferences', 'preferences'],
    ['/account/security', 'security'],
    ['/account/developer', 'developer'],
    ['/account/unknown', 'profile'],
  ] as const)('maps %s to the %s account page', (route, page) => {
    expect(accountPageFromRoute(route)).toBe(page);
    expect(isAccountRoute(route)).toBe(true);
  });

  it('maps valid admin pages and safely falls back for unknown routes', () => {
    expect(adminPageFromRoute('/admin')).toBe('overview');
    expect(adminPageFromRoute('/admin/users')).toBe('users');
    expect(adminPageFromRoute('/admin/invitations')).toBe('invitations');
    expect(adminPageFromRoute('/admin/not-real')).toBe('overview');
    expect(isAdminRoute('/admin/jobs')).toBe(true);
    expect(isAdminRoute('/administrator')).toBe(false);
    expect(isAccountRoute('/')).toBe(false);
  });
});
