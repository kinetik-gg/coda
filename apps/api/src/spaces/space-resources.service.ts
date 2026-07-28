import { Injectable } from '@nestjs/common';
import { resourceTierSchema, type ResourceType } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SPACE_ID, type SpaceResourceType } from './space-constants';

@Injectable()
export class SpaceResourcesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the container for a resource without making callers depend on reconciliation timing.
   * An N-1 restore can temporarily leave a new core row without a surviving join row, and that
   * resource belongs to the fixed Default Space until the startup reconciler fills the mapping.
   */
  async resolveSpaceId(resourceType: SpaceResourceType, resourceId: string): Promise<string> {
    const mapping = await this.prisma.spaceResource.findUnique({
      where: { resourceType_resourceId: { resourceType, resourceId } },
      select: { spaceId: true },
    });
    return mapping?.spaceId ?? DEFAULT_SPACE_ID;
  }

  async resolveActiveMembership(userId: string, resourceType: ResourceType, resourceId: string) {
    const spaceId = await this.resolveSpaceId(resourceType, resourceId);
    const membership = await this.prisma.spaceMembership.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
      include: { role: true, space: true },
    });
    if (!membership || membership.role.archivedAt || membership.space.deletedAt) return null;
    const resourceTier = resourceTierSchema.safeParse(membership.role.resourceTier);
    if (!resourceTier.success) return null;
    return { ...membership, role: { ...membership.role, resourceTier: resourceTier.data } };
  }
}
