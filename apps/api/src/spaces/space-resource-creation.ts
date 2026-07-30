import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { rankBetween } from '../common/rank';
import { DEFAULT_SPACE_ID, type SpaceResourceType } from './space-constants';
import { SpacePermissionService } from './space-permission.service';

type SpaceResourceWriter = Pick<Prisma.TransactionClient, 'spaceResource'>;

/**
 * Places a freshly created resource in its container. The Default Space deliberately gets no row:
 * an absent mapping already resolves to Default (`SpaceResourcesService.resolveSpaceId`) and the
 * boot reconciler backfills it, so the pre-Spaces creation path keeps writing exactly the rows it
 * wrote before Spaces existed.
 */
export async function placeResourceInSpace(
  prisma: SpaceResourceWriter,
  resourceType: SpaceResourceType,
  resourceId: string,
  spaceId: string,
): Promise<void> {
  if (spaceId === DEFAULT_SPACE_ID) return;
  const last = await prisma.spaceResource.findFirst({
    where: { spaceId, resourceType },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  await prisma.spaceResource.create({
    data: { spaceId, resourceType, resourceId, position: rankBetween(last?.position, null) },
  });
}

/**
 * Authorizes where a new screenplay or breakdown may be created.
 *
 * `create_resources` governs a named Space, not creation in general. Access to a resource is
 * additive — direct resource membership OR Space membership — so requiring a Space grant from every
 * caller would turn a Space permission into a precondition for users the Space model does not
 * govern. Two consequences follow, and both are deliberate:
 *
 * - A request that names no Space targets the Default Space and needs no Space grant. The Spaces
 *   migration seeds no Default memberships by construction, so no existing user holds
 *   `create_resources` there; requiring it would break creation for every existing install. This
 *   mirrors `SpaceResourceMovesService.assertMoveAuthorized`, which already exempts Default on both
 *   sides of a move.
 * - Naming a Space is an explicit request to create inside a governed container, so it is asserted.
 *   API credentials are never Space members, so a credential naming a Space receives the same `404`
 *   every other Space route gives it; a credential that names none is unaffected.
 */
@Injectable()
export class SpaceResourceCreationService {
  constructor(private readonly permissions: SpacePermissionService) {}

  async authorizeTarget(userId: string, spaceId?: string): Promise<string> {
    const targetSpaceId = spaceId ?? DEFAULT_SPACE_ID;
    if (targetSpaceId === DEFAULT_SPACE_ID) return DEFAULT_SPACE_ID;
    await this.permissions.assert(userId, targetSpaceId, 'create_resources');
    return targetSpaceId;
  }
}
