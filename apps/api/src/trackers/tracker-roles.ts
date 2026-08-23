import { allTrackerPermissions, type TrackerPermission } from '@coda/contracts';
import type { Prisma } from '@prisma/client';
import { evenlySpacedRanks } from '../common/rank';

// Seeded tracker roles, mirroring the project/screenplay owner/admin/editor/viewer shape. The owner
// always holds every permission the vocabulary offers; there is deliberately no standalone
// comment permission in the role vocabulary (`comment_tracker` is tier-grant-only, see
// tracker-permissions.ts in @coda/contracts).
export const defaultTrackerRoles: Array<{
  name: string;
  permissions: TrackerPermission[];
  isOwner?: boolean;
}> = [
  { name: 'owner', permissions: [...allTrackerPermissions], isOwner: true },
  { name: 'admin', permissions: [...allTrackerPermissions] },
  {
    name: 'editor',
    permissions: ['read_tracker', 'edit_tracker_records', 'manage_tracker_fields'],
  },
  { name: 'viewer', permissions: ['read_tracker'] },
];

/**
 * Provisions the seeded role graph and the owner-role membership for a freshly created tracker,
 * inside the caller's transaction. The owner always holds the owner-role membership so the
 * permission service resolves the owner through the same membership path as every other member.
 */
export async function provisionTrackerAccess(
  tx: Prisma.TransactionClient,
  trackerId: string,
  ownerUserId: string,
): Promise<void> {
  const ranks = evenlySpacedRanks(defaultTrackerRoles.length);
  let ownerRoleId: string | null = null;
  for (const [index, template] of defaultTrackerRoles.entries()) {
    const role = await tx.trackerRole.create({
      data: {
        trackerId,
        name: template.name,
        isOwner: template.isOwner ?? false,
        position: ranks[index]!,
        permissions: { create: template.permissions.map((permission) => ({ permission })) },
      },
    });
    if (template.isOwner) ownerRoleId = role.id;
  }
  await tx.trackerMembership.create({
    data: { trackerId, userId: ownerUserId, roleId: ownerRoleId! },
  });
}
