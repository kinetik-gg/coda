import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

export async function listTrash(prisma: PrismaService, storage: StorageService, projectId: string) {
  const [items, fields, sourceDocuments, storageObjects] = await Promise.all([
    prisma.breakdownItem.findMany({
      where: { projectId, deletedAt: { not: null } },
      select: {
        id: true,
        entityTypeId: true,
        parentId: true,
        title: true,
        displayCode: true,
        version: true,
        deletedAt: true,
        deletedById: true,
        deletionBatchId: true,
        entityType: { select: { id: true, singularName: true, pluralName: true, level: true } },
        parent: { select: { id: true, title: true, displayCode: true, deletedAt: true } },
        _count: { select: { children: true } },
      },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.fieldDefinition.findMany({
      where: { projectId, deletedAt: { not: null } },
      include: { entityType: true },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.sourceDocument.findMany({
      where: { projectId, deletedAt: { not: null } },
      include: { storageObject: true },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.storageObject.findMany({
      where: { projectId, deletedAt: { not: null } },
      include: {
        sourceDocument: { select: { id: true, deletedAt: true } },
        _count: { select: { fieldValues: true } },
      },
      orderBy: { deletedAt: 'desc' },
    }),
  ]);
  return {
    items,
    fields,
    sourceDocuments,
    storageObjects: storageObjects.map((object) => storage.serialize(object)),
  };
}
