import { describe, expect, it } from 'vitest';
import {
  administrationGroup,
  instanceSettingsGroup,
  libraryGroup,
  navGroups,
  railGroups,
  resolveRailCrumbs,
  settingsGroups,
  settingsRailEntry,
} from './nav-model';
import { webResourceTypes } from '../spaces/resource-types';

describe('nav-model', () => {
  it('resolves account and administration routes to their breadcrumbs', () => {
    expect(resolveRailCrumbs('/account')).toEqual(['Account', 'Profile']);
    expect(resolveRailCrumbs('/account/security')).toEqual(['Account', 'Security']);
    expect(resolveRailCrumbs('/admin')).toEqual(['Administration', 'Overview']);
    expect(resolveRailCrumbs('/admin/users')).toEqual(['Administration', 'Users']);
  });

  it('gives every instance-settings section its own breadcrumb trail, distinct from Administration', () => {
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

  it('renders only the Library group on the physical rail — #163 moved the rest behind Settings', () => {
    expect(railGroups).toEqual([libraryGroup]);
    expect(railGroups.flatMap((group) => group.items).map((item) => item.id)).toEqual([
      ...webResourceTypes.map((resourceType) => resourceType.id),
      'trash',
    ]);
  });

  it('derives every resource row, breadcrumb, and Go command source from the web registry', () => {
    for (const resourceType of webResourceTypes) {
      const item = libraryGroup.items.find((candidate) => candidate.id === resourceType.id);
      expect(item).toMatchObject({
        label: resourceType.label,
        path: resourceType.listRoute,
        crumbs: ['Library', resourceType.label],
      });
    }
    expect(webResourceTypes.map((resourceType) => resourceType.id)).toEqual([
      'screenplay',
      'breakdown',
    ]);
  });

  it('groups Account, Administration, and Instance Settings for the settings surface sub-nav', () => {
    expect(settingsGroups.map((group) => group.id)).toEqual([
      'account',
      'administration',
      'instance-settings',
    ]);
    expect(administrationGroup.adminOnly).toBe(true);
    expect(instanceSettingsGroup.adminOnly).toBe(true);
  });

  it('drops the `Settings:` label prefix from every instance-settings item', () => {
    expect(instanceSettingsGroup.items.map((item) => item.label)).toEqual([
      'General',
      'Storage',
      'Backups',
      'Updates',
      'Doctor',
    ]);
    for (const group of navGroups) {
      for (const item of group.items) {
        expect(item.label.startsWith('Settings:')).toBe(false);
      }
    }
  });

  it('keeps Administration and Instance Settings as siblings rather than nesting one in the other', () => {
    expect(instanceSettingsGroup.items.map((item) => item.path)).toEqual([
      '/admin/settings',
      '/admin/settings/storage',
      '/admin/settings/backups',
      '/admin/settings/updates',
      '/admin/settings/doctor',
    ]);
    // Administration's own "Storage" (usage/objects) and Instance Settings' "Storage" (backend
    // config) share a label but resolve to different routes — the group heading disambiguates them
    // now that neither carries a text prefix.
    const adminStorage = administrationGroup.items.find((item) => item.id === 'admin-storage');
    const settingsStorage = instanceSettingsGroup.items.find(
      (item) => item.id === 'settings-storage',
    );
    expect(adminStorage?.label).toBe('Storage');
    expect(settingsStorage?.label).toBe('Storage');
    expect(adminStorage?.path).not.toBe(settingsStorage?.path);
  });

  it('exposes the superset every navigation projection (breadcrumbs, Go menu, palette) reads from', () => {
    expect(navGroups.map((group) => group.id)).toEqual([
      'library',
      'account',
      'administration',
      'instance-settings',
    ]);
  });

  it('marks the rail Settings entry current for the whole of Account and Administration', () => {
    expect(settingsRailEntry.isActive('/account')).toBe(true);
    expect(settingsRailEntry.isActive('/account/security')).toBe(true);
    expect(settingsRailEntry.isActive('/admin')).toBe(true);
    expect(settingsRailEntry.isActive('/admin/settings/storage')).toBe(true);
    expect(settingsRailEntry.isActive('/')).toBe(false);
    expect(settingsRailEntry.isActive('/breakdowns')).toBe(false);
  });
});
