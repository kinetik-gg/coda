import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimedDeletionJob } from '../database/database-capabilities';
import { StorageDeletionService } from './storage-deletion.service';

vi.mock('../config/env', () => ({
  env: () => ({ STORAGE_UPLOAD_RETENTION_HOURS: 24 }),
}));

interface MockJob {
  id: string;
  objectKey: string;
  attempts: number;
}

function mockPrisma(stale: Array<{ id: string; projectId: string; objectKey: string }> = []) {
  const tx = {
    storageObject: {
      findMany: vi.fn().mockResolvedValue(stale),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    storageDeletionJob: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    ...tx,
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
}

// A fake database seam: hands out each queued job once, stamping a fresh fencing claim token exactly
// as the Postgres `claimNextDeletionJob` implementation does. The service is unit-tested against this
// seam; the raw `FOR UPDATE SKIP LOCKED` SQL is proven separately in the adapter's own test.
function mockDb(jobs: MockJob[] = []) {
  const claims = [...jobs];
  return {
    claimNextDeletionJob: vi.fn((): Promise<ClaimedDeletionJob | null> =>
      Promise.resolve(claims.length ? { ...claims.shift()!, claimToken: randomUUID() } : null),
    ),
  };
}

const job = { id: 'job-1', objectKey: 'project/object.pdf', attempts: 0 };

describe('StorageDeletionService', () => {
  it('allows only one local drain at a time', async () => {
    let releaseDeletion!: () => void;
    const deletion = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const db = mockDb([job]);
    const storage = { deletePhysical: vi.fn().mockReturnValue(deletion) };
    const service = new StorageDeletionService(
      mockPrisma() as never,
      storage as never,
      db as never,
    );

    const first = service.drain();
    await vi.waitFor(() => expect(storage.deletePhysical).toHaveBeenCalledOnce());
    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 0 });
    expect(db.claimNextDeletionJob).toHaveBeenCalledOnce();

    releaseDeletion();
    await expect(first).resolves.toEqual({ deleted: 1, pending: 0 });
  });

  it('claims the next job through the seam and removes only the owned claim after deletion', async () => {
    const prisma = mockPrisma();
    const db = mockDb([job]);
    const storage = { deletePhysical: vi.fn().mockResolvedValue(undefined) };
    const service = new StorageDeletionService(prisma as never, storage as never, db as never);

    await expect(service.drain()).resolves.toEqual({ deleted: 1, pending: 0 });
    expect(db.claimNextDeletionJob).toHaveBeenCalledWith(5);
    const deletion = prisma.storageDeletionJob.deleteMany.mock.calls[0]?.[0] as unknown as {
      where: { id: string; claimToken: string };
    };
    expect(deletion.where.id).toBe('job-1');
    expect(deletion.where.claimToken).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('does not duplicate physical deletion when another replica already claimed the job', async () => {
    let releaseDeletion!: () => void;
    const deletion = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    // A single shared seam: once the first worker claims the only job, the second gets nothing back.
    const db = mockDb([job]);
    const firstStorage = { deletePhysical: vi.fn().mockReturnValue(deletion) };
    const secondStorage = { deletePhysical: vi.fn() };
    const first = new StorageDeletionService(
      mockPrisma() as never,
      firstStorage as never,
      db as never,
    );
    const second = new StorageDeletionService(
      mockPrisma() as never,
      secondStorage as never,
      db as never,
    );

    const firstDrain = first.drain();
    await vi.waitFor(() => expect(firstStorage.deletePhysical).toHaveBeenCalledOnce());
    await expect(second.drain()).resolves.toEqual({ deleted: 0, pending: 0 });
    expect(secondStorage.deletePhysical).not.toHaveBeenCalled();

    releaseDeletion();
    await expect(firstDrain).resolves.toEqual({ deleted: 1, pending: 0 });
  });

  it('releases failed claims with retry backoff and a bounded error', async () => {
    const prisma = mockPrisma();
    const db = mockDb([job]);
    const storage = { deletePhysical: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    const service = new StorageDeletionService(prisma as never, storage as never, db as never);

    const startedAt = Date.now();
    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 1 });
    const update = prisma.storageDeletionJob.updateMany.mock.calls[0]?.[0] as unknown as {
      where: { id: string; claimToken: string };
      data: {
        attempts: { increment: number };
        lastError: string;
        notBefore: Date;
        claimToken: null;
        claimedAt: null;
      };
    };
    expect(update).toMatchObject({
      where: { id: 'job-1' },
      data: {
        attempts: { increment: 1 },
        lastError: 'Unavailable',
        claimToken: null,
        claimedAt: null,
      },
    });
    expect(update.where.claimToken).toMatch(/^[0-9a-f-]{36}$/u);
    expect(update.data.notBefore.getTime()).toBeGreaterThanOrEqual(startedAt + 60_000);
  });

  it('atomically queues stale incomplete uploads with deletion delayed past PUT expiry', async () => {
    const stale = [{ id: 'storage-1', projectId: 'project-1', objectKey: 'project-1/object' }];
    const prisma = mockPrisma(stale);
    const storage = { deletePhysical: vi.fn() };
    const service = new StorageDeletionService(
      prisma as never,
      storage as never,
      mockDb() as never,
    );
    const startedAt = Date.now();

    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 0 });
    const findInput = prisma.storageObject.findMany.mock.calls[0]?.[0] as unknown as {
      where: { status: { in: string[] }; createdAt: { lte: Date } };
      take: number;
    };
    expect(findInput).toMatchObject({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      take: 100,
    });
    expect(findInput.where).not.toHaveProperty('deletedAt');
    const createInput = prisma.storageDeletionJob.createMany.mock.calls[0]?.[0] as {
      data: Array<{ projectId: string; objectKey: string; notBefore: Date }>;
      skipDuplicates: boolean;
    };
    expect(createInput).toMatchObject({
      data: [{ projectId: 'project-1', objectKey: 'project-1/object' }],
      skipDuplicates: true,
    });
    expect(createInput.data[0]!.notBefore.getTime()).toBeGreaterThanOrEqual(startedAt + 3_601_000);
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });

  it('does not queue an upload that became ready before the cleanup claim', async () => {
    const stale = [{ id: 'storage-1', projectId: 'project-1', objectKey: 'project-1/object' }];
    const prisma = mockPrisma(stale);
    prisma.storageObject.deleteMany.mockResolvedValueOnce({ count: 0 });
    const storage = { deletePhysical: vi.fn() };
    const service = new StorageDeletionService(
      prisma as never,
      storage as never,
      mockDb() as never,
    );

    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 0 });
    expect(prisma.storageDeletionJob.createMany).not.toHaveBeenCalled();
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });
});
