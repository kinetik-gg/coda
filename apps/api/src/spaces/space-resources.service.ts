import { Injectable } from '@nestjs/common';
import { resourceTierSchema, type ResourceType } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { personalDefaultSpaceId } from './personal-default-space';
import type { SpaceResourceType } from './space-constants';
import { spaceResourceRegistry, type SpaceResourceRegistryEntry } from './space-resource-registry';

@Injectable()
export class SpaceResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext?: RequestAuthContext,
  ) {}

  /**
   * Resolves the container for a resource without making callers depend on reconciliation timing.
   * An N-1 restore can temporarily leave a new core row without a surviving join row, and that
   * resource belongs to its owner's personal Default Space until reconciliation fills the mapping.
   */
  async resolveSpaceId(resourceType: SpaceResourceType, resourceId: string): Promise<string> {
    const mapping = await this.prisma.spaceResource.findUnique({
      where: { resourceType_resourceId: { resourceType, resourceId } },
      select: { spaceId: true },
    });
    if (mapping) return mapping.spaceId;
    const ownerUserId = await spaceResourceRegistry[resourceType].resolveOwner(
      this.prisma,
      resourceId,
    );
    return personalDefaultSpaceId(this.prisma, ownerUserId);
  }

  async resolveActiveMembership(userId: string, resourceType: ResourceType, resourceId: string) {
    if (this.authContext?.credential()) return null;
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
    const memberships = this.authContext?.credential()
      ? []
      : await this.prisma.spaceMembership.findMany({
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

    if (readableSpaceIds.length) {
      const activeIds = await entry.listActiveIds(this.prisma);
      const mapped = activeIds.length
        ? await this.prisma.spaceResource.findMany({
            where: { resourceType, resourceId: { in: activeIds } },
            select: { resourceId: true },
          })
        : [];
      const mappedIds = new Set(mapped.map((mapping) => mapping.resourceId));
      const unmappedAssignments = await Promise.all(
        activeIds
          .filter((resourceId) => !mappedIds.has(resourceId))
          .map(async (resourceId) => ({
            resourceId,
            spaceId: await personalDefaultSpaceId(
              this.prisma,
              await entry.resolveOwner(this.prisma, resourceId),
            ),
          })),
      );
      for (const assignment of unmappedAssignments) {
        if (readableSpaceIds.includes(assignment.spaceId)) accessibleIds.add(assignment.resourceId);
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
    const resolved = await Promise.all(
      [...accessibleIds].map(async (resourceId) => ({
        resourceId,
        spaceId:
          spaceByResourceId.get(resourceId) ??
          (await personalDefaultSpaceId(
            this.prisma,
            await entry.resolveOwner(this.prisma, resourceId),
          )),
      })),
    );
    return resolved
      .filter((assignment) => assignment.spaceId === filterSpaceId)
      .map((assignment) => assignment.resourceId);
  }
}
