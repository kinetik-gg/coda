import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import { lockProjectLifecycle } from '../projects/project-lifecycle-lock';
import type { StorageDeletionService } from '../storage/storage-deletion.service';
import { storageDeletionNotBefore } from '../storage/storage-deletion-policy';

export const PROJECT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const PROJECT_PURGE_BATCH_SIZE = 100;
const PROJECT_PURGE_MAX_WAIT_MS = 10_000;
const PROJECT_PURGE_TIMEOUT_MS = 60_000;
const logger = new Logger('ProjectPurge');

interface ProjectPurgeEligibility {
  deletedBefore?: Date;
  ownerUserId?: string;
}

export async function purgeExpiredProjects(
  db: DatabaseCapabilities,
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
      try {
        const removed = await purgeProjectData(db, prisma, storageDeletions, project.id, {
          deletedBefore: cutoff,
        });
        if (removed) purged += 1;
      } catch (error) {
        logger.error(
          `Unable to purge expired project ${project.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    if (expired.length < PROJECT_PURGE_BATCH_SIZE) break;
    lastProjectId = expired.at(-1)?.id;
  }
  return purged;
}

export async function purgeProjectData(
  db: DatabaseCapabilities,
  prisma: PrismaService,
  storageDeletions: StorageDeletionService,
  projectId: string,
  eligibility: ProjectPurgeEligibility = {},
): Promise<boolean> {
  const purged = await prisma.$transaction(
    async (tx) => {
      await lockProjectLifecycle(db, tx, projectId);
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
    },
    { maxWait: PROJECT_PURGE_MAX_WAIT_MS, timeout: PROJECT_PURGE_TIMEOUT_MS },
  );
  if (!purged) return false;
  storageDeletions.triggerDrain();
  return true;
}

async function queueProjectStorageDeletions(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  const notBefore = storageDeletionNotBefore();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "storage_deletion_jobs" ("project_id", "object_key", "not_before")
    SELECT "project_id", "object_key", ${notBefore}
    FROM "storage_objects"
    WHERE "project_id" = CAST(${projectId} AS UUID)
    ON CONFLICT ("object_key") DO NOTHING
  `);
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
