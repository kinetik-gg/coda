import { Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { storageDeletionNotBefore } from '../storage/storage-deletion-policy';
import { PROJECT_RETENTION_MS } from './trash-project-purger';

/**
 * Screenplay trash lifecycle. Authorization is enforced upstream in `TrashService` via
 * `ScreenplayPermissionService` at the `manage_screenplay_settings` level (non-member -> 404,
 * member-without-permission -> 403; see the access-control ADR), so the mutation helpers here
 * operate by `screenplayId` — a manage-level member need not be the owner. `listTrashedScreenplays`
 * remains owner-scoped: the trash view is "screenplays I own that are trashed". The retention window
 * is intentionally the *same* constant as projects (issue #126).
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
      where: { id: screenplayId, deletedAt: null },
      data: {
        deletedAt,
        deletedById: userId,
        deletionBatchId: batch,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new NotFoundException('Screenplay not found');
    const screenplay = await tx.screenplay.findFirstOrThrow({
      where: { id: screenplayId },
      select: screenplayTrashSelection,
    });
    return serializeScreenplayTrash(screenplay);
  });
}

export async function restoreScreenplay(prisma: PrismaService, screenplayId: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.screenplay.updateMany({
      where: { id: screenplayId, deletedAt: { not: null } },
      data: {
        deletedAt: null,
        deletedById: null,
        deletionBatchId: null,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new NotFoundException('Trashed screenplay not found');
    const screenplay = await tx.screenplay.findFirstOrThrow({
      where: { id: screenplayId },
      select: screenplayTrashSelection,
    });
    return serializeScreenplayTrash(screenplay);
  });
}

export async function purgeScreenplay(prisma: PrismaService, screenplayId: string) {
  const screenplay = await prisma.screenplay.findFirst({
    where: { id: screenplayId, deletedAt: { not: null } },
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
 * Hard-deletes a screenplay, its revisions, its access-control graph, and its collaboration state.
 * The access-control tables (roles/memberships/invitations), collaboration log, and comment threads
 * intentionally have no foreign key onto `screenplays` — the backup round-trip convention — so
 * their rows are removed explicitly here rather than by cascade (thread comments and role
 * permissions still cascade from their new-table parents). Revisions retain their screenplay FK
 * and would cascade, but are removed explicitly so the intent stays enforced in-transaction.
 *
 * Any breakdown that follows this screenplay is unlinked here for the same reason: purging a
 * screenplay must leave no orphaned `breakdown_screenplay_links` row behind (issue #238). The
 * breakdown's own PDF source references are untouched — they never pointed at the screenplay.
 *
 * Import artifacts are handled first and in two steps, because they own blobs as well as rows
 * (issue #244): each original is enqueued for deletion before its row disappears, so a purge can
 * never drop the only record of an object key and strand the bytes in the blob store.
 *
 * Revision pins into this screenplay go the same way as the link (issue #239). Purging deletes the
 * revisions they name, so leaving the pin rows behind would strand every affected reference in the
 * `unavailable` state permanently; dropping them lets each reference fall back to the PDF and pages
 * it has always carried. The `ItemSourceReference` rows themselves are never touched here.
 */
async function purgeScreenplayRecord(prisma: PrismaService, screenplayId: string): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const artifacts = await tx.screenplayImportArtifact.findMany({
      where: { screenplayId },
      select: { objectKey: true },
    });
    if (artifacts.length) {
      const notBefore = storageDeletionNotBefore();
      await tx.storageDeletionJob.createMany({
        data: artifacts.map((artifact) => ({
          projectId: screenplayId,
          objectKey: artifact.objectKey,
          notBefore,
        })),
        skipDuplicates: true,
      });
      await tx.screenplayImportArtifact.deleteMany({ where: { screenplayId } });
    }
    await tx.breakdownScreenplayLink.deleteMany({ where: { screenplayId } });
    await tx.itemSourceRevisionPin.deleteMany({ where: { screenplayId } });
    await tx.screenplayCollabUpdate.deleteMany({ where: { screenplayId } });
    await tx.screenplayCollabCheckpoint.deleteMany({ where: { screenplayId } });
    await tx.screenplayCommentThread.deleteMany({ where: { screenplayId } });
    await tx.screenplayInvitation.deleteMany({ where: { screenplayId } });
    await tx.screenplayMembership.deleteMany({ where: { screenplayId } });
    await tx.screenplayRole.deleteMany({ where: { screenplayId } });
    await tx.screenplayRevision.deleteMany({ where: { screenplayId } });
    await tx.screenplay.delete({ where: { id: screenplayId } });
  });
}
