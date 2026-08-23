import { describe, expect, it, vi } from 'vitest';
import { enqueueTrackerStoragePurge } from './storage-purge';

function tx(objects: Array<{ objectKey: string }>) {
  return {
    storageObject: { findMany: vi.fn().mockResolvedValue(objects) },
    storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: objects.length }) },
  };
}

describe('enqueueTrackerStoragePurge', () => {
  it('enqueues one tracker-stamped deletion job per owned object key', async () => {
    const client = tx([{ objectKey: 'tracker-1/a' }, { objectKey: 'tracker-1/b' }]);
    const startedAt = Date.now();

    await expect(enqueueTrackerStoragePurge(client as never, 'tracker-1')).resolves.toBe(2);

    expect(client.storageObject.findMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-1' },
      select: { objectKey: true },
    });
    const create = client.storageDeletionJob.createMany.mock.calls[0]?.[0] as unknown as {
      data: Array<{
        projectId: string | null;
        trackerId: string | null;
        objectKey: string;
        notBefore: Date;
      }>;
      skipDuplicates: boolean;
    };
    expect(create.skipDuplicates).toBe(true);
    expect(create.data.map((job) => job.objectKey)).toEqual(['tracker-1/a', 'tracker-1/b']);
    for (const job of create.data) {
      // The tracker side of the discriminator, never a borrowed project id.
      expect(job.trackerId).toBe('tracker-1');
      expect(job.projectId).toBeNull();
      // Deletion stays delayed past any PUT URL the object may still honor.
      expect(job.notBefore.getTime()).toBeGreaterThanOrEqual(startedAt + 3_601_000);
    }
  });

  it('includes soft-deleted rows so a purge reclaims every blob the tracker ever wrote', async () => {
    const client = tx([{ objectKey: 'tracker-1/deleted' }]);
    (client.storageObject.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { objectKey: 'tracker-1/live' },
      { objectKey: 'tracker-1/trashed' },
    ]);

    await expect(enqueueTrackerStoragePurge(client as never, 'tracker-1')).resolves.toBe(2);
    const where = (
      client.storageObject.findMany.mock.calls[0]?.[0] as unknown as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('is a no-op for a tracker without storage objects', async () => {
    const client = tx([]);

    await expect(enqueueTrackerStoragePurge(client as never, 'tracker-1')).resolves.toBe(0);
    expect(client.storageDeletionJob.createMany).not.toHaveBeenCalled();
  });
});
