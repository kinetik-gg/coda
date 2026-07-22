import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { lockProjectRoleLifecycle } from './project-role-lifecycle';

interface OwnershipTransferInput {
  userId: string;
  projectId: string;
  membershipId: string;
  actorMembershipId: string;
  version: number;
}

export async function transferProjectOwnership(
  prisma: PrismaService,
  input: OwnershipTransferInput,
) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, version: input.version },
    });
    const target = await tx.projectMembership.findFirst({
      where: { id: input.membershipId, projectId: input.projectId },
      include: { user: { select: { status: true } } },
    });
    if (!project || !target) throw new ConflictException('Project or membership changed');
    if (target.user.status !== 'ACTIVE') {
      throw new ConflictException('Ownership can only be transferred to an active account');
    }
    if (target.userId === input.userId) {
      throw new ConflictException('Select another member for ownership transfer');
    }
    const ownerRole = await tx.projectRole.findFirstOrThrow({
      where: { projectId: input.projectId, isOwner: true },
    });
    const demotionCandidate = await tx.projectRole.findFirst({
      where: { projectId: input.projectId, isOwner: false, archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!demotionCandidate) {
      throw new ConflictException('No active role is available for the previous owner');
    }
    await lockProjectRoleLifecycle(tx, demotionCandidate.id);
    const demotionRole = await tx.projectRole.findFirstOrThrow({
      where: {
        id: demotionCandidate.id,
        projectId: input.projectId,
        isOwner: false,
        archivedAt: null,
      },
    });
    const claimed = await tx.project.updateMany({
      where: {
        id: input.projectId,
        version: input.version,
        ownerUserId: input.userId,
      },
      data: {
        ownerUserId: target.userId,
        version: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Project ownership has changed; refresh and retry');
    }
    await tx.projectMembership.update({
      where: { id: input.actorMembershipId },
      data: { roleId: demotionRole.id, version: { increment: 1 } },
    });
    await tx.projectMembership.update({
      where: { id: target.id },
      data: { roleId: ownerRole.id, version: { increment: 1 } },
    });
    await tx.activityEvent.create({
      data: {
        projectId: input.projectId,
        actorId: input.userId,
        action: 'TRANSFERRED',
        resourceType: 'project_owner',
        resourceId: target.userId,
      },
    });
    return tx.project.findUniqueOrThrow({ where: { id: input.projectId } });
  });
}
