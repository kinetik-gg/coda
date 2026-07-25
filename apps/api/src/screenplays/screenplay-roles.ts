import { allScreenplayPermissions, type ScreenplayPermission } from '@coda/contracts';
import type { Prisma } from '@prisma/client';
import { evenlySpacedRanks } from '../common/rank';

// Seeded screenplay roles, mirroring the project owner/admin/editor/viewer shape (ADR:
// docs/adr-screenplay-access-control.md). The backfill migration seeds the identical set for
// pre-existing screenplays; new screenplays are provisioned here at creation.
export const defaultScreenplayRoles: Array<{
  name: string;
  permissions: ScreenplayPermission[];
  isOwner?: boolean;
}> = [
  { name: 'owner', permissions: [...allScreenplayPermissions], isOwner: true },
  { name: 'admin', permissions: [...allScreenplayPermissions] },
  { name: 'editor', permissions: ['read_screenplay', 'edit_screenplay'] },
  { name: 'viewer', permissions: ['read_screenplay'] },
];

/**
 * Provisions the seeded role graph and the owner-role membership for a freshly created screenplay,
 * inside the caller's transaction. The owner always holds the owner-role membership so the
 * permission service resolves the owner through the same membership path as every other member.
 */
export async function provisionScreenplayAccess(
  tx: Prisma.TransactionClient,
  screenplayId: string,
  ownerUserId: string,
): Promise<void> {
  const ranks = evenlySpacedRanks(defaultScreenplayRoles.length);
  let ownerRoleId: string | null = null;
  for (const [index, template] of defaultScreenplayRoles.entries()) {
    const role = await tx.screenplayRole.create({
      data: {
        screenplayId,
        name: template.name,
        isOwner: template.isOwner ?? false,
        position: ranks[index]!,
        permissions: { create: template.permissions.map((permission) => ({ permission })) },
      },
    });
    if (template.isOwner) ownerRoleId = role.id;
  }
  await tx.screenplayMembership.create({
    data: { screenplayId, userId: ownerUserId, roleId: ownerRoleId! },
  });
}
