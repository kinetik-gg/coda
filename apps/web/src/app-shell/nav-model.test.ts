import { describe, expect, it } from 'vitest';
import { railGroups, resolveRailCrumbs } from './nav-model';

describe('nav-model', () => {
  it('resolves account and administration routes to their rail breadcrumbs', () => {
    expect(resolveRailCrumbs('/account')).toEqual(['Account', 'Profile']);
    expect(resolveRailCrumbs('/account/security')).toEqual(['Account', 'Security']);
    expect(resolveRailCrumbs('/admin')).toEqual(['Administration', 'Overview']);
    expect(resolveRailCrumbs('/admin/users')).toEqual(['Administration', 'Users']);
  });

  it('flattens every instance-settings section under Administration', () => {
    expect(resolveRailCrumbs('/admin/settings')).toEqual([
      'Administration',
      'Instance Settings',
      'General',
    ]);
    expect(resolveRailCrumbs('/admin/settings/storage')).toEqual([
      'Administration',
      'Instance Settings',
      'Storage',
    ]);
    expect(resolveRailCrumbs('/admin/settings/doctor')).toEqual([
      'Administration',
      'Instance Settings',
      'Doctor',
    ]);
  });

  it('falls back to a single crumb for an unknown route', () => {
    expect(resolveRailCrumbs('/nowhere')).toEqual(['Coda']);
  });

  it('declares the settings sections as administration rail items (single nav source)', () => {
    const admin = railGroups.find((group) => group.id === 'administration');
    expect(admin?.adminOnly).toBe(true);
    const settings = admin?.items.filter((item) => item.id.startsWith('settings-')) ?? [];
    expect(settings.map((item) => item.path)).toEqual([
      '/admin/settings',
      '/admin/settings/storage',
      '/admin/settings/backups',
      '/admin/settings/updates',
      '/admin/settings/doctor',
    ]);
  });
});
