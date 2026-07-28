import { Injectable } from '@nestjs/common';
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
}
