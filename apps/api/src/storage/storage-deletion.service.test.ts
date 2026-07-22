import { describe, expect, it, vi } from 'vitest';
import { StorageDeletionService } from './storage-deletion.service';

vi.mock('../config/env', () => ({
  env: () => ({ STORAGE_UPLOAD_RETENTION_HOURS: 24 }),
}));

interface MockJob {
  id: string;
  objectKey: string;
  attempts: number;
}

function mockPrisma(
  jobs: MockJob[] = [],
  stale: Array<{ id: string; projectId: string; objectKey: string }> = [],
) {
  const claims = [...jobs];
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
    $queryRaw: vi
      .fn()
      .mockImplementation(() => Promise.resolve(claims.length ? [claims.shift()!] : [])),
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
}

const job = { id: 'job-1', objectKey: 'project/object.pdf', attempts: 0 };

describe('StorageDeletionService', () => {
  it('allows only one local drain at a time', async () => {
    let releaseDeletion!: () => void;
    const deletion = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const prisma = mockPrisma([job]);
    const storage = { deletePhysical: vi.fn().mockReturnValue(deletion) };
    const service = new StorageDeletionService(prisma as never, storage as never);

    const first = service.drain();
    await vi.waitFor(() => expect(storage.deletePhysical).toHaveBeenCalledOnce());
    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 0 });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();

    releaseDeletion();
    await expect(first).resolves.toEqual({ deleted: 1, pending: 0 });
  });

  it('atomically claims eligible jobs and removes only the owned claim after deletion', async () => {
    const prisma = mockPrisma([job]);
    const storage = { deletePhysical: vi.fn().mockResolvedValue(undefined) };
    const service = new StorageDeletionService(prisma as never, storage as never);

    await expect(service.drain()).resolves.toEqual({
      deleted: 1,
      pending: 0,
    });
    const query = prisma.$queryRaw.mock.calls[0]?.[0] as { strings: string[] };
    expect(query.strings.join('?')).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.strings.join('?')).toContain('"not_before" <= CURRENT_TIMESTAMP');
    expect(query.strings.join('?')).toContain('"claim_token"');
    expect(query.strings.join('?')).not.toContain('"object_key" IN');
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
    const prisma = mockPrisma([job]);
    const firstStorage = { deletePhysical: vi.fn().mockReturnValue(deletion) };
    const secondStorage = { deletePhysical: vi.fn() };
    const first = new StorageDeletionService(prisma as never, firstStorage as never);
    const second = new StorageDeletionService(prisma as never, secondStorage as never);

    const firstDrain = first.drain();
    await vi.waitFor(() => expect(firstStorage.deletePhysical).toHaveBeenCalledOnce());
    await expect(second.drain()).resolves.toEqual({
      deleted: 0,
      pending: 0,
    });
    expect(secondStorage.deletePhysical).not.toHaveBeenCalled();

    releaseDeletion();
    await expect(firstDrain).resolves.toEqual({ deleted: 1, pending: 0 });
  });

  it('releases failed claims with retry backoff and a bounded error', async () => {
    const prisma = mockPrisma([job]);
    const storage = { deletePhysical: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    const service = new StorageDeletionService(prisma as never, storage as never);

    const startedAt = Date.now();
    await expect(service.drain()).resolves.toEqual({
      deleted: 0,
      pending: 1,
    });
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
    const prisma = mockPrisma([], stale);
    const storage = { deletePhysical: vi.fn() };
    const service = new StorageDeletionService(prisma as never, storage as never);
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
    const prisma = mockPrisma([], stale);
    prisma.storageObject.deleteMany.mockResolvedValueOnce({ count: 0 });
    const storage = { deletePhysical: vi.fn() };
    const service = new StorageDeletionService(prisma as never, storage as never);

    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 0 });
    expect(prisma.storageDeletionJob.createMany).not.toHaveBeenCalled();
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });
});
