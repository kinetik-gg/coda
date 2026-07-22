import type { PrismaService } from '../prisma/prisma.service';

export function projectExternalDetail(prisma: PrismaService, projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
      entityTypes: {
        orderBy: { level: 'asc' as const },
        select: {
          id: true,
          projectId: true,
          parentTypeId: true,
          singularName: true,
          pluralName: true,
          displayPrefix: true,
          level: true,
          position: true,
          enabled: true,
          version: true,
          _count: { select: { items: { where: { deletedAt: null } } } },
        },
      },
      sourceDocuments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
        select: {
          id: true,
          projectId: true,
          storageObjectId: true,
          title: true,
          pageCount: true,
          version: true,
          createdAt: true,
          storageObject: {
            select: {
              id: true,
              projectId: true,
              kind: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
              status: true,
              version: true,
            },
          },
        },
      },
    },
  });
}
