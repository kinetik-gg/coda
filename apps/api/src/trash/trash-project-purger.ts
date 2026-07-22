import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { lockProjectLifecycle } from '../projects/project-lifecycle-lock';
import type { StorageDeletionService } from '../storage/storage-deletion.service';
import { storageDeletionNotBefore } from '../storage/storage-deletion-policy';

export const PROJECT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const PROJECT_PURGE_BATCH_SIZE = 100;
export const PROJECT_STORAGE_BATCH_SIZE = 100;

interface ProjectPurgeEligibility {
  deletedBefore?: Date;
  ownerUserId?: string;
}

export async function purgeExpiredProjects(
  prisma: PrismaService,
  storageDeletions: StorageDeletionService,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - PROJECT_RETENTION_MS);
  let purged = 0;
  let lastProjectId: string | undefined;
  for (;;) {
    const expired = await prisma.project.findMany({
      where: {
        deletedAt: { lte: cutoff },
        ...(lastProjectId ? { id: { gt: lastProjectId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PROJECT_PURGE_BATCH_SIZE,
    });
    for (const project of expired) {
      const removed = await purgeProjectData(prisma, storageDeletions, project.id, {
        deletedBefore: cutoff,
      });
      if (removed) purged += 1;
    }
    if (expired.length < PROJECT_PURGE_BATCH_SIZE) break;
    lastProjectId = expired.at(-1)?.id;
  }
  return purged;
}

export async function purgeProjectData(
  prisma: PrismaService,
  storageDeletions: StorageDeletionService,
  projectId: string,
  eligibility: ProjectPurgeEligibility = {},
): Promise<boolean> {
  const purged = await prisma.$transaction(async (tx) => {
    await lockProjectLifecycle(tx, projectId);
    const project = await tx.project.findFirst({
      where: {
        id: projectId,
        deletedAt: eligibility.deletedBefore ? { lte: eligibility.deletedBefore } : { not: null },
        ...(eligibility.ownerUserId ? { ownerUserId: eligibility.ownerUserId } : {}),
      },
      select: { id: true },
    });
    if (!project) return false;
    await queueProjectStorageDeletions(tx, projectId);
    await tx.fieldValueOption.deleteMany({ where: { fieldValue: { item: { projectId } } } });
    await tx.fieldValue.deleteMany({ where: { item: { projectId } } });
    await tx.itemSourceReference.deleteMany({ where: { item: { projectId } } });
    await tx.sourceDocument.deleteMany({ where: { projectId } });
    await tx.storageObject.deleteMany({ where: { projectId } });
    await tx.project.delete({ where: { id: projectId } });
    return true;
  });
  if (!purged) return false;
  storageDeletions.triggerDrain();
  return true;
}

async function queueProjectStorageDeletions(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  let lastObjectId: string | undefined;
  for (;;) {
    const objects = await tx.storageObject.findMany({
      where: {
        projectId,
        ...(lastObjectId ? { id: { gt: lastObjectId } } : {}),
      },
      select: { id: true, objectKey: true },
      orderBy: { id: 'asc' },
      take: PROJECT_STORAGE_BATCH_SIZE,
    });
    await queueStorageDeletions(
      tx,
      projectId,
      objects.map(({ objectKey }) => objectKey),
    );
    if (objects.length < PROJECT_STORAGE_BATCH_SIZE) return;
    lastObjectId = objects.at(-1)?.id;
  }
}

export async function queueStorageDeletions(
  tx: Prisma.TransactionClient,
  projectId: string,
  objectKeys: string[],
): Promise<void> {
  if (objectKeys.length === 0) return;
  const notBefore = storageDeletionNotBefore();
  await tx.storageDeletionJob.createMany({
    data: objectKeys.map((objectKey) => ({ projectId, objectKey, notBefore })),
    skipDuplicates: true,
  });
}

export function deleteQueuedStorage(
  storageDeletions: StorageDeletionService,
  objectKeys: string[],
): void {
  if (objectKeys.length === 0) return;
  storageDeletions.triggerDrain();
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
