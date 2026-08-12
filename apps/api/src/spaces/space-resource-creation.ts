import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { rankBetween } from '../common/rank';
import { PrismaService } from '../prisma/prisma.service';
import type { SpaceResourceType } from './space-constants';
import { personalDefaultSpaceId } from './personal-default-space';
import { SpacePermissionService } from './space-permission.service';

type SpaceResourceWriter = Pick<Prisma.TransactionClient, 'spaceResource'>;

/**
 * Places a freshly created resource in its container. Personal Defaults require an explicit row:
 * there is no longer an instance-wide id that an absent mapping can safely imply.
 */
export async function placeResourceInSpace(
  prisma: SpaceResourceWriter,
  resourceType: SpaceResourceType,
  resourceId: string,
  spaceId: string,
): Promise<void> {
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
 * Omitting `spaceId` targets the account owner's personal Default Space. Defaults use ordinary
 * roles and memberships, so explicit and implicit targets pass through the same permission check.
 */
@Injectable()
export class SpaceResourceCreationService {
  constructor(
    private readonly permissions: SpacePermissionService,
    private readonly prisma: PrismaService,
  ) {}

  async authorizeTarget(userId: string, spaceId?: string): Promise<string> {
    const targetSpaceId = spaceId ?? (await personalDefaultSpaceId(this.prisma, userId));
    await this.permissions.assert(userId, targetSpaceId, 'create_resources');
    return targetSpaceId;
  }
}
