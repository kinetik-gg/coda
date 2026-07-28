import { Injectable } from '@nestjs/common';
import { resourceTierSchema, type ResourceType } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SPACE_ID, type SpaceResourceType } from './space-constants';
import { spaceResourceRegistry, type SpaceResourceRegistryEntry } from './space-resource-registry';

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

  async listAccessibleResourceIds(
    userId: string,
    resourceType: ResourceType,
    directResourceIds: string[],
    filterSpaceId?: string,
  ): Promise<string[]> {
    const entry: SpaceResourceRegistryEntry = spaceResourceRegistry[resourceType];
    const memberships = await this.prisma.spaceMembership.findMany({
      where: { userId, role: { archivedAt: null }, space: { deletedAt: null } },
      select: { spaceId: true, role: { select: { resourceTier: true } } },
    });
    const readableSpaceIds = memberships.flatMap((membership) => {
      const tier = resourceTierSchema.safeParse(membership.role.resourceTier);
      return tier.success && entry.tierPermissions(tier.data).includes(entry.readPermission)
        ? [membership.spaceId]
        : [];
    });
    const reachableMappings = readableSpaceIds.length
      ? await this.prisma.spaceResource.findMany({
          where: { resourceType, spaceId: { in: readableSpaceIds } },
          select: { resourceId: true, spaceId: true },
        })
      : [];
    const accessibleIds = new Set([
      ...directResourceIds,
      ...reachableMappings.map((mapping) => mapping.resourceId),
    ]);

    if (readableSpaceIds.includes(DEFAULT_SPACE_ID)) {
      const activeIds = await entry.listActiveIds(this.prisma);
      const mapped = await this.prisma.spaceResource.findMany({
        where: { resourceType, resourceId: { in: activeIds } },
        select: { resourceId: true },
      });
      const mappedIds = new Set(mapped.map((mapping) => mapping.resourceId));
      for (const resourceId of activeIds) {
        if (!mappedIds.has(resourceId)) accessibleIds.add(resourceId);
      }
    }
    if (!filterSpaceId || accessibleIds.size === 0) return [...accessibleIds];

    const assignments = await this.prisma.spaceResource.findMany({
      where: { resourceType, resourceId: { in: [...accessibleIds] } },
      select: { resourceId: true, spaceId: true },
    });
    const spaceByResourceId = new Map(
      assignments.map((assignment) => [assignment.resourceId, assignment.spaceId]),
    );
    return [...accessibleIds].filter(
      (resourceId) => (spaceByResourceId.get(resourceId) ?? DEFAULT_SPACE_ID) === filterSpaceId,
    );
  }
}
