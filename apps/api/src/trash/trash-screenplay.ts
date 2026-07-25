import { Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PROJECT_RETENTION_MS } from './trash-project-purger';

/**
 * Screenplays are owner-scoped documents (no project membership), so their trash
 * lifecycle mirrors the project one on the columns and retention window but is
 * gated purely by ownership. The retention window is intentionally the *same*
 * constant as projects (issue #126: "retention window identical to projects").
 */
export const SCREENPLAY_RETENTION_MS = PROJECT_RETENTION_MS;
export const SCREENPLAY_PURGE_BATCH_SIZE = 100;
const logger = new Logger('ScreenplayPurge');

const screenplayTrashSelection = {
  id: true,
  ownerUserId: true,
  title: true,
  filename: true,
  paperSize: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedById: true,
  deletionBatchId: true,
} as const;

export function screenplayPurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + SCREENPLAY_RETENTION_MS);
}

export function serializeScreenplayTrash<T extends { deletedAt: Date | null }>(screenplay: T) {
  return {
    ...screenplay,
    purgeAfter: screenplay.deletedAt ? screenplayPurgeAfter(screenplay.deletedAt) : null,
  };
}

export async function trashScreenplay(prisma: PrismaService, userId: string, screenplayId: string) {
  const batch = randomUUID();
  const deletedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const result = await tx.screenplay.updateMany({
      where: { id: screenplayId, ownerUserId: userId, deletedAt: null },
      data: {
        deletedAt,
        deletedById: userId,
        deletionBatchId: batch,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new NotFoundException('Screenplay not found');
    const screenplay = await tx.screenplay.findFirstOrThrow({
      where: { id: screenplayId, ownerUserId: userId },
      select: screenplayTrashSelection,
    });
    return serializeScreenplayTrash(screenplay);
  });
}

export async function restoreScreenplay(
  prisma: PrismaService,
  userId: string,
  screenplayId: string,
) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.screenplay.updateMany({
      where: { id: screenplayId, ownerUserId: userId, deletedAt: { not: null } },
      data: {
        deletedAt: null,
        deletedById: null,
        deletionBatchId: null,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new NotFoundException('Trashed screenplay not found');
    const screenplay = await tx.screenplay.findFirstOrThrow({
      where: { id: screenplayId, ownerUserId: userId },
      select: screenplayTrashSelection,
    });
    return serializeScreenplayTrash(screenplay);
  });
}

export async function purgeScreenplay(prisma: PrismaService, userId: string, screenplayId: string) {
  const screenplay = await prisma.screenplay.findFirst({
    where: { id: screenplayId, ownerUserId: userId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!screenplay) throw new NotFoundException('Trashed screenplay not found');
  await purgeScreenplayRecord(prisma, screenplayId);
  return { purged: true };
}

export async function listTrashedScreenplays(prisma: PrismaService, userId: string) {
  const screenplays = await prisma.screenplay.findMany({
    where: { ownerUserId: userId, deletedAt: { not: null } },
    select: screenplayTrashSelection,
    orderBy: { deletedAt: 'desc' },
  });
  return screenplays.map((screenplay) => ({
    ...serializeScreenplayTrash(screenplay),
    canRestore: true,
    canPurge: true,
  }));
}

export async function purgeExpiredScreenplays(prisma: PrismaService, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SCREENPLAY_RETENTION_MS);
  let purged = 0;
  let lastScreenplayId: string | undefined;
  for (;;) {
    const expired = await prisma.screenplay.findMany({
      where: {
        deletedAt: { lte: cutoff },
        ...(lastScreenplayId ? { id: { gt: lastScreenplayId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: SCREENPLAY_PURGE_BATCH_SIZE,
    });
    for (const screenplay of expired) {
      try {
        await purgeScreenplayRecord(prisma, screenplay.id);
        purged += 1;
      } catch (error) {
        logger.error(
          `Unable to purge expired screenplay ${screenplay.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    if (expired.length < SCREENPLAY_PURGE_BATCH_SIZE) break;
    lastScreenplayId = expired.at(-1)?.id;
  }
  return purged;
}

/**
 * Hard-deletes a screenplay and its revisions. Revisions cascade on the
 * screenplay foreign key, but they are removed explicitly so the intent
 * ("purge removes revisions") is enforced in-transaction and unit-testable.
 */
async function purgeScreenplayRecord(prisma: PrismaService, screenplayId: string): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.screenplayRevision.deleteMany({ where: { screenplayId } });
    await tx.screenplay.delete({ where: { id: screenplayId } });
  });
}
