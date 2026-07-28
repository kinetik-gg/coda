import { z } from 'zod';
import type { Permission } from './project-permissions';
import type { ScreenplayPermission } from './screenplay-permissions';
import { resourceTierSchema, type ResourceTier } from './space-permissions';

// The resource types a Space can hold. This is the single declaration of "what resource types
// exist" — nav-model.ts, the trash surfaces, and the API previously each hard-coded the set
// themselves. Adding a resource type means adding one entry to RESOURCE_TYPE_REGISTRY below, not
// editing a switch in three places. Kept in its own leaf module (rather than inline in index.ts)
// so it can depend on `Permission`, `ScreenplayPermission`, and `ResourceTier` without index.ts
// and resource-types.ts importing each other — a cycle `quality:cycles` (madge) fails the build
// on.
export const resourceTypeSchema = z.enum(['breakdown', 'screenplay']);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const allResourceTypes = resourceTypeSchema.options;

/**
 * What a tier adds to a resource type's permission set, on top of everything the tier below it
 * already grants. `viewer` is the floor; `contributor` and `manager` list only their own
 * additions so a tier's total grant is never hand-duplicated across entries.
 */
interface ResourceTierIncrements<TPermission extends string> {
  readonly viewer: readonly TPermission[];
  readonly contributor: readonly TPermission[];
  readonly manager: readonly TPermission[];
}

/**
 * Never list `delete_project`, `invite_members`, `manage_roles`, or `manage_member_roles` in a
 * resource type's increments below. A Space tier grants working access to a resource's contents;
 * it deliberately never grants the authority to destroy the resource, re-share it, or reassign
 * its own membership roles — that stays resource-level. `assertNeverGrantsExcludedPermissions`
 * enforces this at module load, so a well-meaning future addition to the table fails loudly
 * instead of silently widening what a Space role can do.
 */
const NEVER_GRANTED_BY_TIER = [
  'delete_project',
  'invite_members',
  'manage_roles',
  'manage_member_roles',
] as const;

const RESOURCE_TYPE_REGISTRY = {
  breakdown: {
    viewer: ['read_project', 'comment'],
    contributor: ['manage_items', 'manage_source_documents', 'manage_storage_objects'],
    manager: ['manage_entity_types', 'manage_fields', 'manage_project_settings'],
  } satisfies ResourceTierIncrements<Permission>,
  screenplay: {
    viewer: ['read_screenplay'],
    contributor: ['edit_screenplay'],
    manager: ['manage_screenplay_settings'],
  } satisfies ResourceTierIncrements<ScreenplayPermission>,
} as const satisfies Record<ResourceType, ResourceTierIncrements<string>>;

const TIER_ORDER = resourceTierSchema.options;

function cumulativePermissions<TPermission extends string>(
  increments: ResourceTierIncrements<TPermission>,
  tier: ResourceTier,
): readonly TPermission[] {
  const cutoff = TIER_ORDER.indexOf(tier);
  return TIER_ORDER.slice(0, cutoff + 1).flatMap((includedTier) => increments[includedTier]);
}

function assertNeverGrantsExcludedPermissions(): void {
  for (const resourceType of allResourceTypes) {
    const increments = RESOURCE_TYPE_REGISTRY[resourceType];
    for (const tier of TIER_ORDER) {
      for (const permission of cumulativePermissions(increments, tier)) {
        if ((NEVER_GRANTED_BY_TIER as readonly string[]).includes(permission)) {
          throw new Error(
            `resource-types: tier "${tier}" for resource type "${resourceType}" grants ` +
              `"${permission}", which must never be granted by a Space tier`,
          );
        }
      }
    }
  }
}
assertNeverGrantsExcludedPermissions();

/** Function overloads so callers get the concrete permission vocabulary for the resource type
 * they asked about, rather than the union of every resource type's permissions. */
export function permissionsForResourceTier(
  resourceType: 'breakdown',
  tier: ResourceTier,
): readonly Permission[];
export function permissionsForResourceTier(
  resourceType: 'screenplay',
  tier: ResourceTier,
): readonly ScreenplayPermission[];
export function permissionsForResourceTier(
  resourceType: ResourceType,
  tier: ResourceTier,
): readonly (Permission | ScreenplayPermission)[];
export function permissionsForResourceTier(
  resourceType: ResourceType,
  tier: ResourceTier,
): readonly (Permission | ScreenplayPermission)[] {
  return cumulativePermissions(RESOURCE_TYPE_REGISTRY[resourceType], tier);
}
