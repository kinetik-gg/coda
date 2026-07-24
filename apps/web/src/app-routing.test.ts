import { describe, expect, it } from 'vitest';
import {
  accountPageFromRoute,
  adminPageFromRoute,
  instanceSettingsSectionFromRoute,
  instanceSettingsSectionPath,
  isAccountRoute,
  isAdminRoute,
  isInstanceSettingsRoute,
  managementProjectId,
  screenplayIdFromRoute,
  workspaceProjectId,
} from './app-routing';

describe('application routing', () => {
  it('recognizes workspace and management breakdown routes without accepting suffixes', () => {
    expect(workspaceProjectId('/breakdowns/a0b1-c2d3')).toBe('a0b1-c2d3');
    expect(workspaceProjectId('/breakdowns/A0B1')).toBe('A0B1');
    expect(workspaceProjectId('/breakdowns/a0b1/manage')).toBeUndefined();
    expect(workspaceProjectId('/breakdowns/not-a-uuid!')).toBeUndefined();
    expect(managementProjectId('/breakdowns/a0b1/manage')).toBe('a0b1');
    expect(managementProjectId('/breakdowns/a0b1/manage/more')).toBeUndefined();
    expect(workspaceProjectId('/projects/a0b1-c2d3')).toBeUndefined();
  });

  it('recognizes screenplay editor routes without accepting suffixes', () => {
    expect(screenplayIdFromRoute('/screenplays/a0b1-c2d3')).toBe('a0b1-c2d3');
    expect(screenplayIdFromRoute('/screenplays/a0b1/export.fountain')).toBeUndefined();
    expect(screenplayIdFromRoute('/screenplays/not-valid!')).toBeUndefined();
  });

  it.each([
    ['/account', 'profile'],
    ['/account/preferences', 'preferences'],
    ['/account/security', 'security'],
    ['/account/sessions', 'sessions'],
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

  it.each([
    ['/admin/settings', 'general'],
    ['/admin/settings/general', 'general'],
    ['/admin/settings/storage', 'storage'],
    ['/admin/settings/backups', 'backups'],
    ['/admin/settings/updates', 'updates'],
    ['/admin/settings/doctor', 'doctor'],
    ['/admin/settings/not-real', 'general'],
  ] as const)('maps %s to the %s instance settings section', (route, section) => {
    expect(instanceSettingsSectionFromRoute(route)).toBe(section);
    expect(isInstanceSettingsRoute(route)).toBe(true);
  });

  it('recognizes instance settings routes without accepting unrelated admin routes', () => {
    expect(isInstanceSettingsRoute('/admin')).toBe(false);
    expect(isInstanceSettingsRoute('/admin/storage')).toBe(false);
    expect(isInstanceSettingsRoute('/admin/settingsx')).toBe(false);
  });

  it('builds instance settings section paths, collapsing general to the bare prefix', () => {
    expect(instanceSettingsSectionPath('general')).toBe('/admin/settings');
    expect(instanceSettingsSectionPath('storage')).toBe('/admin/settings/storage');
    expect(instanceSettingsSectionPath('backups')).toBe('/admin/settings/backups');
    expect(instanceSettingsSectionPath('updates')).toBe('/admin/settings/updates');
    expect(instanceSettingsSectionPath('doctor')).toBe('/admin/settings/doctor');
  });
});
