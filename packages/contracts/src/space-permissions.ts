import { z } from 'zod';

// Space access control. Spaces are a container above the project/screenplay resource graph, so
// this vocabulary is deliberately its own — it governs the Space itself (membership, settings,
// where resources live), not what a member may do inside a given resource. Kept in its own leaf
// module (rather than inline in index.ts) so resource-types.ts can depend on `ResourceTier`
// without index.ts and resource-types.ts importing each other — a cycle `quality:cycles` (madge)
// fails the build on.
export const spacePermissionSchema = z.enum([
  'read_space',
  'manage_space_settings',
  'invite_members',
  'manage_member_roles',
  'manage_roles',
  'create_resources',
  'move_resources',
  'delete_space',
]);
export type SpacePermission = z.infer<typeof spacePermissionSchema>;

export const allSpacePermissions = spacePermissionSchema.options;

// How a space role projects onto the resources (projects, screenplays, ...) inside it. A Space
// role does not enumerate resource permissions directly — growing the resource-permission
// vocabulary would otherwise force a matching edit to the space vocabulary every time. Instead a
// member holds one of three tiers per Space, and resource-types.ts projects each tier onto the
// concrete permission set for every resource type the Space can hold.
export const resourceTierSchema = z.enum(['viewer', 'contributor', 'manager']);
export type ResourceTier = z.infer<typeof resourceTierSchema>;
