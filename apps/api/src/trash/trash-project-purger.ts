import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageDeletionService } from '../storage/storage-deletion.service';
import type { StorageService } from '../storage/storage.service';

export const PROJECT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

interface PurgeableProject {
  id: string;
  storageObjects: Array<{ objectKey: string }>;
}

export async function purgeExpiredProjects(
  prisma: PrismaService,
  storage: StorageService,
  storageDeletions: StorageDeletionService | undefined,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - PROJECT_RETENTION_MS);
  const expired = await prisma.project.findMany({
    where: { deletedAt: { lte: cutoff } },
    include: { storageObjects: true },
  });
  let purged = 0;
  for (const project of expired) {
    try {
      await purgeProjectData(prisma, storage, storageDeletions, project);
      purged += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') continue;
      throw error;
    }
  }
  return purged;
}

export async function purgeProjectData(
  prisma: PrismaService,
  storage: StorageService,
  storageDeletions: StorageDeletionService | undefined,
  project: PurgeableProject,
): Promise<void> {
  const projectId = project.id;
  const objectKeys = project.storageObjects.map(({ objectKey }) => objectKey);
  await prisma.$transaction(async (tx) => {
    await queueStorageDeletions(tx, storageDeletions, projectId, objectKeys);
    await tx.fieldValueOption.deleteMany({ where: { fieldValue: { item: { projectId } } } });
    await tx.fieldValue.deleteMany({ where: { item: { projectId } } });
    await tx.itemSourceReference.deleteMany({ where: { item: { projectId } } });
    await tx.sourceDocument.deleteMany({ where: { projectId } });
    await tx.storageObject.deleteMany({ where: { projectId } });
    await tx.project.delete({ where: { id: projectId } });
  });
  await deleteQueuedStorage(storage, storageDeletions, objectKeys);
}

export async function queueStorageDeletions(
  tx: Prisma.TransactionClient,
  storageDeletions: StorageDeletionService | undefined,
  projectId: string,
  objectKeys: string[],
): Promise<void> {
  if (!storageDeletions || objectKeys.length === 0) return;
  await tx.storageDeletionJob.createMany({
    data: objectKeys.map((objectKey) => ({ projectId, objectKey })),
    skipDuplicates: true,
  });
}

export async function deleteQueuedStorage(
  storage: StorageService,
  storageDeletions: StorageDeletionService | undefined,
  objectKeys: string[],
): Promise<void> {
  if (objectKeys.length === 0) return;
  if (storageDeletions) {
    await storageDeletions.drain(objectKeys);
    return;
  }
  for (const objectKey of objectKeys) await storage.deletePhysical(objectKey);
}

export function projectPurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + PROJECT_RETENTION_MS);
}

export function serializeProjectTrash<T extends { deletedAt: Date | null }>(project: T) {
  return {
    ...project,
    purgeAfter: project.deletedAt ? projectPurgeAfter(project.deletedAt) : null,
  };
}
