import { z } from 'zod';

// Tracker access control (parallel to the project and screenplay permission graphs). A
// deliberately small, record-shaped vocabulary; names match the project/screenplay vocabularies
// where the concept is identical — including the sharing authorities, so a role that can re-share
// a tracker reads the same as one that re-shares a screenplay. Kept in its own leaf module
// (rather than inline in index.ts) so resource-types.ts can depend on `TrackerPermission` without
// index.ts and resource-types.ts importing each other — a cycle `quality:cycles` (madge) fails
// the build on.
//
// `comment_tracker` is deliberately absent here: like every tier grant it lives only in the
// resource-types.ts tier table, so Space tiers can grant commenting without roles ever managing
// it as a standalone permission.
export const trackerPermissionSchema = z.enum([
  'read_tracker',
  'edit_tracker_records',
  'manage_tracker_fields',
  'manage_tracker_settings',
  'invite_members',
  'manage_member_roles',
  'manage_roles',
]);
export type TrackerPermission = z.infer<typeof trackerPermissionSchema>;

export const allTrackerPermissions = trackerPermissionSchema.options;
