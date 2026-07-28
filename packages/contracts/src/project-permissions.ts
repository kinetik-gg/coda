import { z } from 'zod';

// Project access control (the resource-level vocabulary a Space role projects onto). Kept in its
// own leaf module (rather than inline in index.ts) so resource-types.ts can depend on
// `Permission` without index.ts and resource-types.ts importing each other — a cycle
// `quality:cycles` (madge) fails the build on.
export const permissionSchema = z.enum([
  'read_project',
  'manage_items',
  'manage_entity_types',
  'manage_fields',
  'manage_source_documents',
  'manage_storage_objects',
  'comment',
  'invite_members',
  'manage_member_roles',
  'manage_roles',
  'manage_project_settings',
  'delete_project',
]);
export type Permission = z.infer<typeof permissionSchema>;

export const allPermissions = permissionSchema.options;
