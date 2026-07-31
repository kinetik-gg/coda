import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { MoveSpaceResource } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  spaceResourceRegistry,
  type SpaceMovePreflight,
  type SpaceResourcePrisma,
} from './space-resource-registry';
import { DEFAULT_SPACE_ID } from './space-constants';
import { SpacePermissionService } from './space-permission.service';

const DEFAULT_RESOURCE_POSITION = '00000000';

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
      let moved = await this.moveMapping(tx, sourceSpaceId, input);
      if (moved.count === 0 && sourceSpaceId === DEFAULT_SPACE_ID) {
        await tx.spaceResource.upsert({
          where: {
            resourceType_resourceId: {
              resourceType: input.resourceType,
              resourceId: input.resourceId,
            },
          },
          update: {},
          create: {
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            spaceId: DEFAULT_SPACE_ID,
            position: DEFAULT_RESOURCE_POSITION,
          },
        });
        moved = await this.moveMapping(tx, sourceSpaceId, input);
      }
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

  /**
   * The Default Space is exempt from the `move_resources` check on both the source and
   * target side, deliberately (#266). This is safe only because the Default Space has zero
   * `space_memberships` by construction — the Spaces migration seeds none
   * (`spaces-migration.test.ts`), and nothing in this codebase can ever add one: every path
   * that grants a Space permission (`SpacesService.addMembership`) itself requires a Space
   * membership first, so Default's own emptiness is self-enforcing through the app, and the
   * live-database replay in `spaces-migration.integration.test.ts` asserts the migration
   * itself never introduces one. Resource-level authority (`entry.canMove` below) is still
   * required regardless of Space, so this is not open access.
   *
   * `SpaceResourceCreationService.authorizeTarget` (#271) mirrors this exact rule for
   * resource creation and documents the same reasoning: requiring a Default-Space
   * permission would break every existing account on first deploy, since none of them holds
   * one. If Default ever gains members outside a migration, this exemption becomes load-
   * bearing in a different way — worth a maintainer's attention rather than silent reliance.
   */
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
      sourceSpaceId === DEFAULT_SPACE_ID
        ? Promise.resolve(null)
        : this.permissions.assert(userId, sourceSpaceId, 'move_resources'),
      input.targetSpaceId === DEFAULT_SPACE_ID
        ? Promise.resolve(null)
        : this.permissions.assert(userId, input.targetSpaceId, 'move_resources'),
      entry.canMove(this.prisma, userId, input.resourceId),
    ]);
    if (
      (sourceSpaceId !== DEFAULT_SPACE_ID && !sourceSpace) ||
      (input.targetSpaceId !== DEFAULT_SPACE_ID && !targetSpace) ||
      !mayMove
    ) {
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
