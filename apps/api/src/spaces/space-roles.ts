import { allSpacePermissions, type ResourceTier, type SpacePermission } from '@coda/contracts';
import type { Prisma } from '@prisma/client';
import { evenlySpacedRanks } from '../common/rank';

export const defaultSpaceRoles: Array<{
  name: string;
  permissions: SpacePermission[];
  resourceTier: ResourceTier;
  isOwner?: boolean;
}> = [
  { name: 'owner', permissions: [...allSpacePermissions], resourceTier: 'manager', isOwner: true },
  {
    name: 'manager',
    permissions: [
      'read_space',
      'manage_space_settings',
      'invite_members',
      'manage_member_roles',
      'manage_roles',
      'create_resources',
      'move_resources',
    ],
    resourceTier: 'manager',
  },
  {
    name: 'contributor',
    permissions: ['read_space', 'create_resources'],
    resourceTier: 'contributor',
  },
  { name: 'viewer', permissions: ['read_space'], resourceTier: 'viewer' },
];

export async function provisionSpaceAccess(
  tx: Prisma.TransactionClient,
  spaceId: string,
  ownerUserId: string,
): Promise<void> {
  const ranks = evenlySpacedRanks(defaultSpaceRoles.length);
  let ownerRoleId: string | null = null;
  for (const [index, template] of defaultSpaceRoles.entries()) {
    const role = await tx.spaceRole.create({
      data: {
        spaceId,
        name: template.name,
        isOwner: template.isOwner ?? false,
        position: ranks[index]!,
        resourceTier: template.resourceTier,
        permissions: { create: template.permissions.map((permission) => ({ permission })) },
      },
    });
    if (template.isOwner) ownerRoleId = role.id;
  }
  await tx.spaceMembership.create({ data: { spaceId, userId: ownerUserId, roleId: ownerRoleId! } });
}
