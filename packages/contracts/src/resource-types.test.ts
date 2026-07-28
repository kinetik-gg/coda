import { describe, expect, it } from 'vitest';
import { allPermissions } from './project-permissions';
import { allResourceTypes, permissionsForResourceTier, resourceTypeSchema } from './resource-types';
import { allScreenplayPermissions } from './screenplay-permissions';
import { resourceTierSchema } from './space-permissions';

// Mirrors the exclusion list in the issue and in resource-types.ts's own module-load assertion.
// Hardcoded here (rather than imported) so this test still fails if a future edit removes the
// module-load assertion — the two checks are independent guards against the same regression.
const NEVER_GRANTED_BY_TIER = [
  'delete_project',
  'invite_members',
  'manage_roles',
  'manage_member_roles',
] as const;

describe('permissionsForResourceTier', () => {
  it('resolves every (resourceType, tier) pair to a non-empty permission set', () => {
    // Iterates the enums, not a hand-written list of resource types, so a resource type added to
    // resourceTypeSchema without a matching registry entry fails here instead of being skipped.
    for (const resourceType of resourceTypeSchema.options) {
      for (const tier of resourceTierSchema.options) {
        const permissions = permissionsForResourceTier(resourceType, tier);
        expect(Array.isArray(permissions)).toBe(true);
        expect(permissions.length).toBeGreaterThan(0);
      }
    }
  });

  it('is cumulative: each tier grants a strict superset of the tier below it', () => {
    for (const resourceType of resourceTypeSchema.options) {
      const viewer = new Set(permissionsForResourceTier(resourceType, 'viewer'));
      const contributor = new Set(permissionsForResourceTier(resourceType, 'contributor'));
      const manager = new Set(permissionsForResourceTier(resourceType, 'manager'));

      for (const permission of viewer) {
        expect(contributor.has(permission)).toBe(true);
      }
      for (const permission of contributor) {
        expect(manager.has(permission)).toBe(true);
      }

      // Strictly cumulative: contributor and manager each add at least one permission, they
      // don't merely repeat the tier below.
      expect(contributor.size).toBeGreaterThan(viewer.size);
      expect(manager.size).toBeGreaterThan(contributor.size);
    }
  });

  it('never grants resource-level administration permissions, at any tier, for any resource type', () => {
    for (const resourceType of resourceTypeSchema.options) {
      for (const tier of resourceTierSchema.options) {
        const permissions = permissionsForResourceTier(resourceType, tier);
        for (const excluded of NEVER_GRANTED_BY_TIER) {
          expect(permissions).not.toContain(excluded);
        }
      }
    }
  });

  it('draws breakdown permissions from the project permission vocabulary', () => {
    for (const tier of resourceTierSchema.options) {
      for (const permission of permissionsForResourceTier('breakdown', tier)) {
        expect(allPermissions).toContain(permission);
      }
    }
  });

  it('draws screenplay permissions from the screenplay permission vocabulary', () => {
    for (const tier of resourceTierSchema.options) {
      for (const permission of permissionsForResourceTier('screenplay', tier)) {
        expect(allScreenplayPermissions).toContain(permission);
      }
    }
  });

  it('declares exactly the resource types the registry projects', () => {
    expect(allResourceTypes).toEqual(resourceTypeSchema.options);
  });
});
