import { ConflictException } from '@nestjs/common';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import { lockSpaceRoleLifecycle } from './space-role-lifecycle';

interface SpaceOwnershipTransferInput {
  userId: string;
  spaceId: string;
  membershipId: string;
  actorMembershipId: string;
  version: number;
}

export async function transferSpaceOwnership(
  db: DatabaseCapabilities,
  prisma: PrismaService,
  input: SpaceOwnershipTransferInput,
) {
  return prisma.$transaction(async (tx) => {
    const space = await tx.space.findFirst({
      where: { id: input.spaceId, version: input.version, deletedAt: null },
      select: { isDefault: true },
    });
    if (!space) throw new ConflictException('Space or membership changed');
    if (space.isDefault) {
      throw new ConflictException('Ownership of the Default Space cannot be transferred');
    }
    const target = await tx.spaceMembership.findFirst({
      where: { id: input.membershipId, spaceId: input.spaceId },
    });
    if (!target) throw new ConflictException('Space or membership changed');
    const targetUser = await tx.user.findUnique({
      where: { id: target.userId },
      select: { status: true },
    });
    if (targetUser?.status !== 'ACTIVE') {
      throw new ConflictException('Ownership can only be transferred to an active account');
    }
    if (target.id === input.actorMembershipId) {
      throw new ConflictException('Select another member for ownership transfer');
    }
    const ownerRole = await tx.spaceRole.findFirstOrThrow({
      where: { spaceId: input.spaceId, isOwner: true },
    });
    const demotionCandidate = await tx.spaceRole.findFirst({
      where: { spaceId: input.spaceId, isOwner: false, archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!demotionCandidate) {
      throw new ConflictException('No active role is available for the previous owner');
    }
    await lockSpaceRoleLifecycle(db, tx, demotionCandidate.id);
    const demotionRole = await tx.spaceRole.findFirstOrThrow({
      where: {
        id: demotionCandidate.id,
        spaceId: input.spaceId,
        isOwner: false,
        archivedAt: null,
      },
    });
    const claimed = await tx.space.updateMany({
      where: { id: input.spaceId, version: input.version, ownerUserId: input.userId },
      data: { ownerUserId: target.userId, version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Space ownership has changed; refresh and retry');
    }
    await tx.spaceMembership.update({
      where: { id: input.actorMembershipId },
      data: { roleId: demotionRole.id, version: { increment: 1 } },
    });
    await tx.spaceMembership.update({
      where: { id: target.id },
      data: { roleId: ownerRole.id, version: { increment: 1 } },
    });
    return tx.space.findUniqueOrThrow({ where: { id: input.spaceId } });
  });
}
