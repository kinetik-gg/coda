import { Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { enqueueTrackerStoragePurge } from '../storage/storage-purge';
import { PROJECT_RETENTION_MS } from './trash-project-purger';

/**
 * Tracker trash lifecycle, mirroring the screenplay twin (`trash-screenplay.ts`). Authorization is
 * enforced upstream — trash through `TrackersService.remove`, restore/purge through
 * `TrackerTrashService` at the `manage_tracker_settings` level held by DIRECT membership — so the
 * mutation helpers here operate by `trackerId`. `listTrashedTrackers` remains owner-scoped: the
 * trash view is "trackers I own that are trashed". The retention window is intentionally the
 * *same* constant as projects and screenplays (issue #126).
 */
export const TRACKER_RETENTION_MS = PROJECT_RETENTION_MS;
export const TRACKER_PURGE_BATCH_SIZE = 100;
const logger = new Logger('TrackerPurge');

const trackerTrashSelection = {
  id: true,
  ownerUserId: true,
  name: true,
  description: true,
  version: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedById: true,
  deletionBatchId: true,
} as const;

export function trackerPurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRACKER_RETENTION_MS);
}

export function serializeTrackerTrash<T extends { deletedAt: Date | null }>(tracker: T) {
  return {
    ...tracker,
    purgeAfter: tracker.deletedAt ? trackerPurgeAfter(tracker.deletedAt) : null,
  };
}

export async function restoreTracker(prisma: PrismaService, trackerId: string) {
  return prisma.$transaction(async (tx) => {
    // Version AND revision bump: S4's soft delete bumps both, so restore moves both counters too.
    const result = await tx.tracker.updateMany({
      where: { id: trackerId, deletedAt: { not: null } },
      data: {
        deletedAt: null,
        deletedById: null,
        deletionBatchId: null,
        version: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    if (!result.count) throw new NotFoundException('Trashed tracker not found');
    const tracker = await tx.tracker.findFirstOrThrow({
      where: { id: trackerId },
      select: trackerTrashSelection,
    });
    return serializeTrackerTrash(tracker);
  });
}

export async function purgeTracker(prisma: PrismaService, trackerId: string) {
  const tracker = await prisma.tracker.findFirst({
    where: { id: trackerId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!tracker) throw new NotFoundException('Trashed tracker not found');
  await purgeTrackerRecord(prisma, trackerId);
  return { purged: true };
}

export async function listTrashedTrackers(prisma: PrismaService, userId: string) {
  const trackers = await prisma.tracker.findMany({
    where: { ownerUserId: userId, deletedAt: { not: null } },
    select: trackerTrashSelection,
    orderBy: { deletedAt: 'desc' },
  });
  return trackers.map((tracker) => ({
    ...serializeTrackerTrash(tracker),
    canRestore: true,
    canPurge: true,
  }));
}

export async function purgeExpiredTrackers(prisma: PrismaService, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - TRACKER_RETENTION_MS);
  let purged = 0;
  let lastTrackerId: string | undefined;
  for (;;) {
    const expired = await prisma.tracker.findMany({
      where: {
        deletedAt: { lte: cutoff },
        ...(lastTrackerId ? { id: { gt: lastTrackerId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: TRACKER_PURGE_BATCH_SIZE,
    });
    for (const tracker of expired) {
      try {
        await purgeTrackerRecord(prisma, tracker.id);
        purged += 1;
      } catch (error) {
        logger.error(
          `Unable to purge expired tracker ${tracker.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    if (expired.length < TRACKER_PURGE_BATCH_SIZE) break;
    lastTrackerId = expired.at(-1)?.id;
  }
  return purged;
}

/**
 * Hard-deletes a tracker and every child family table it owns. The role graph (roles,
 * memberships, invitations), the saved-layout pair, and the activity feed carry plain
 * `trackerId` columns with no foreign key onto `trackers` — the appended-table backup convention
 * (see schema.prisma) — so their rows are removed explicitly here rather than by cascade; role
 * permissions cascade from their role parent. The two content chains that do take an in-family FK
 * (`tracker_fields`, `tracker_records`) are still cleared explicitly so the intent stays enforced
 * in-transaction, child rows before the parents whose delete would cascade them.
 *
 * Blob reclamation rides the outbox like every other reclamation: `StorageObject.trackerId` is a
 * plain discriminator column, so nothing would cascade those rows or their bytes. Every object key
 * is enqueued FIRST — before any row that records it disappears — via
 * `enqueueTrackerStoragePurge`, then the row set itself is removed. Tracker-bound API credentials
 * keep their real foreign key onto `trackers` and cascade with the final row delete, exactly as
 * project-bound credentials cascade with a purged project.
 *
 * Instance invitations may embed a tracker membership grant by `trackerId` plus `trackerRoleId`;
 * the invitation rows are removed before the roles they name, because `tracker_role_id` restricts
 * role deletion while `instance_invitations.tracker_id` would otherwise only cascade at the very
 * end.
 */
async function purgeTrackerRecord(prisma: PrismaService, trackerId: string): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await enqueueTrackerStoragePurge(tx, trackerId);
    const roles = await tx.trackerRole.findMany({
      where: { trackerId },
      select: { id: true },
    });
    const roleIds = roles.map((role) => role.id);
    await tx.trackerFieldValueOption.deleteMany({
      where: { fieldValue: { record: { trackerId } } },
    });
    await tx.trackerFieldValue.deleteMany({ where: { record: { trackerId } } });
    await tx.trackerComment.deleteMany({ where: { record: { trackerId } } });
    await tx.trackerRecord.deleteMany({ where: { trackerId } });
    await tx.trackerFieldOption.deleteMany({ where: { field: { trackerId } } });
    await tx.trackerField.deleteMany({ where: { trackerId } });
    await tx.trackerWorkspaceDefault.deleteMany({ where: { trackerId } });
    await tx.trackerUserWorkspaceLayout.deleteMany({ where: { trackerId } });
    await tx.activityEvent.deleteMany({ where: { trackerId } });
    await tx.instanceInvitation.deleteMany({
      where: { OR: [{ trackerId }, { trackerRoleId: { in: roleIds } }] },
    });
    await tx.trackerInvitation.deleteMany({ where: { trackerId } });
    await tx.trackerMembership.deleteMany({ where: { trackerId } });
    await tx.trackerRole.deleteMany({ where: { trackerId } });
    await tx.storageObject.deleteMany({ where: { trackerId } });
    await tx.tracker.delete({ where: { id: trackerId } });
  });
}
