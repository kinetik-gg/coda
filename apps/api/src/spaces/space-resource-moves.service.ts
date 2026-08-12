import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { MoveSpaceResource } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  spaceResourceRegistry,
  type SpaceMovePreflight,
  type SpaceResourcePrisma,
} from './space-resource-registry';
import { SpacePermissionService } from './space-permission.service';

@Injectable()
export class SpaceResourceMovesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: SpacePermissionService,
  ) {}

  async preflight(
    userId: string,
    sourceSpaceId: string,
    input: MoveSpaceResource,
  ): Promise<SpaceMovePreflight> {
    await this.assertMoveAuthorized(userId, sourceSpaceId, input);
    return this.preflightFor(sourceSpaceId, input);
  }

  async move(userId: string, sourceSpaceId: string, input: MoveSpaceResource) {
    await this.assertMoveAuthorized(userId, sourceSpaceId, input);
    return this.prisma.$transaction(async (tx) => {
      const preflight = await this.preflightFor(sourceSpaceId, input, tx);
      const moved = await this.moveMapping(tx, sourceSpaceId, input);
      if (moved.count !== 1) {
        throw new ConflictException('Resource location has changed; refresh and retry');
      }
      return { ...preflight, resourceType: input.resourceType, resourceId: input.resourceId };
    });
  }

  private moveMapping(
    prisma: Pick<PrismaService, 'spaceResource'>,
    sourceSpaceId: string,
    input: MoveSpaceResource,
  ) {
    return prisma.spaceResource.updateMany({
      where: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        spaceId: sourceSpaceId,
      },
      data: { spaceId: input.targetSpaceId },
    });
  }

  private async assertMoveAuthorized(
    userId: string,
    sourceSpaceId: string,
    input: MoveSpaceResource,
  ): Promise<void> {
    if (sourceSpaceId === input.targetSpaceId) {
      throw new ConflictException('Select a different target Space');
    }
    const entry = spaceResourceRegistry[input.resourceType];
    const [sourceSpace, targetSpace, mayMove] = await Promise.all([
      this.permissions.assert(userId, sourceSpaceId, 'move_resources'),
      this.permissions.assert(userId, input.targetSpaceId, 'move_resources'),
      entry.canMove(this.prisma, userId, input.resourceId),
    ]);
    if (!sourceSpace || !targetSpace || !mayMove) {
      throw new ForbiddenException(
        'Resource ownership or settings permission is required to move it',
      );
    }
  }

  private async preflightFor(
    sourceSpaceId: string,
    input: MoveSpaceResource,
    prisma: SpaceResourcePrisma & Pick<PrismaService, 'spaceMembership'> = this.prisma,
  ): Promise<SpaceMovePreflight> {
    const entry = spaceResourceRegistry[input.resourceType];
    const memberships = await prisma.spaceMembership.findMany({
      where: {
        spaceId: { in: [sourceSpaceId, input.targetSpaceId] },
        role: { archivedAt: null },
        space: { deletedAt: null },
      },
      select: { spaceId: true, userId: true },
    });
    const sourceMemberUserIds = memberships
      .filter((membership) => membership.spaceId === sourceSpaceId)
      .map((membership) => membership.userId);
    const targetMemberUserIds = memberships
      .filter((membership) => membership.spaceId === input.targetSpaceId)
      .map((membership) => membership.userId);
    return entry.movePreflight(prisma, input.resourceId, sourceMemberUserIds, targetMemberUserIds);
  }
}
