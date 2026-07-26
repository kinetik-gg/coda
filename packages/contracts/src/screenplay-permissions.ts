import { z } from 'zod';

// Screenplay access control (parallel to the project permission graph). A deliberately small,
// document-shaped vocabulary; names match the project vocabulary where the concept is identical.
// Kept in its own leaf module (rather than inline in index.ts) so the live-collaboration wire
// protocol (screenplay-collab.ts) can depend on `ScreenplayPermission` without index.ts and
// screenplay-collab.ts importing each other — a cycle `quality:cycles` (madge) fails the build on.
export const screenplayPermissionSchema = z.enum([
  'read_screenplay',
  'edit_screenplay',
  'invite_members',
  'manage_member_roles',
  'manage_roles',
  'manage_screenplay_settings',
]);
export type ScreenplayPermission = z.infer<typeof screenplayPermissionSchema>;

export const allScreenplayPermissions = screenplayPermissionSchema.options;
