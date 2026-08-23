import type { Prisma } from '@prisma/client';
import { storageDeletionNotBefore } from './storage-deletion-policy';

/**
 * Enqueues the blob-deletion outbox jobs for every storage object a tracker owns — live,
 * soft-deleted, pending, or failed. The trackers trash purge (epic #386, S11) calls this inside
 * its purge transaction: `StorageObject.trackerId` is a plain discriminator column with no
 * relation, so nothing cascade-deletes these rows or their blobs, and the physical deletes must
 * ride the outbox like every other reclamation.
 *
 * Jobs are stamped on the tracker side of the deletion-job discriminator (never as a project id)
 * and deduplicated by `objectKey` (`skipDuplicates`), so a tracker that was queued before — for
 * example by the stale-upload sweep — purges cleanly a second time.
 */
export async function enqueueTrackerStoragePurge(
  tx: Prisma.TransactionClient,
  trackerId: string,
  now = new Date(),
): Promise<number> {
  const objects = await tx.storageObject.findMany({
    where: { trackerId },
    select: { objectKey: true },
  });
  if (!objects.length) return 0;
  await tx.storageDeletionJob.createMany({
    data: objects.map((object) => ({
      projectId: null,
      trackerId,
      objectKey: object.objectKey,
      notBefore: storageDeletionNotBefore(now),
    })),
    skipDuplicates: true,
  });
  return objects.length;
}
