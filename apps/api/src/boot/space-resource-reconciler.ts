import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_SPACE_ID,
  SPACE_RESOURCE_TYPES,
  type SpaceResourceType,
} from '../spaces/space-constants';

interface ReconciliationResult {
  created: number;
  deleted: number;
}

interface ResourceRow {
  id: string;
  createdAt: Date;
}

function positionFor(index: number): string {
  return String(index + 1).padStart(8, '0');
}

async function resourcesFor(
  tx: Prisma.TransactionClient,
  resourceType: SpaceResourceType,
): Promise<ResourceRow[]> {
  const query = {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: { id: true, createdAt: true },
  };
  return resourceType === 'breakdown' ? tx.project.findMany(query) : tx.screenplay.findMany(query);
}

async function reconcileType(
  tx: Prisma.TransactionClient,
  resourceType: SpaceResourceType,
): Promise<ReconciliationResult> {
  const [resources, mappings] = await Promise.all([
    resourcesFor(tx, resourceType),
    tx.spaceResource.findMany({
      where: { resourceType },
      select: { id: true, resourceId: true },
    }),
  ]);
  const resourceIds = new Set(resources.map(({ id }) => id));
  const mappedIds = new Set(mappings.map(({ resourceId }) => resourceId));
  const missing = resources.flatMap(({ id }, index) =>
    mappedIds.has(id)
      ? []
      : [
          {
            spaceId: DEFAULT_SPACE_ID,
            resourceType,
            resourceId: id,
            position: positionFor(index),
          },
        ],
  );
  const orphanIds = mappings
    .filter(({ resourceId }) => !resourceIds.has(resourceId))
    .map(({ id }) => id);
  const created = missing.length
    ? await tx.spaceResource.createMany({ data: missing, skipDuplicates: true })
    : { count: 0 };
  const deleted = orphanIds.length
    ? await tx.spaceResource.deleteMany({ where: { id: { in: orphanIds } } })
    : { count: 0 };
  return { created: created.count, deleted: deleted.count };
}

@Injectable()
export class SpaceResourceReconciler {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Repairs only the two registered resource types. Unknown future types are left untouched, while
   * missing rows go to Default and typed rows whose core resource disappeared are removed.
   */
  async reconcile(): Promise<ReconciliationResult> {
    return this.prisma.$transaction(async (tx) => {
      let created = 0;
      let deleted = 0;
      for (const resourceType of SPACE_RESOURCE_TYPES) {
        const result = await reconcileType(tx, resourceType);
        created += result.created;
        deleted += result.deleted;
      }
      return { created, deleted };
    });
  }
}
