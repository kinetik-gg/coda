import { describe, expect, it, vi } from 'vitest';
import { StorageDeletionService } from './storage-deletion.service';

describe('StorageDeletionService', () => {
  it('allows only one outbox drain at a time to prevent duplicate physical deletion', async () => {
    let releaseDeletion!: () => void;
    const deletion = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const prisma = {
      storageDeletionJob: {
        findMany: vi.fn().mockResolvedValue([{ id: 'job-1', objectKey: 'object' }]),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
      },
    };
    const storage = { deletePhysical: vi.fn().mockReturnValue(deletion) };
    const service = new StorageDeletionService(prisma as never, storage as never);

    const first = service.drain();
    await vi.waitFor(() => expect(storage.deletePhysical).toHaveBeenCalledOnce());
    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 0 });
    expect(prisma.storageDeletionJob.findMany).toHaveBeenCalledOnce();

    releaseDeletion();
    await expect(first).resolves.toEqual({ deleted: 1, pending: 0 });
  });

  it('removes completed jobs after idempotent physical deletion', async () => {
    const jobs = [{ id: 'job-1', objectKey: 'project/object.pdf' }];
    const prisma = {
      storageDeletionJob: {
        findMany: vi.fn().mockResolvedValue(jobs),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
      },
    };
    const storage = { deletePhysical: vi.fn().mockResolvedValue(undefined) };
    const service = new StorageDeletionService(prisma as never, storage as never);

    await expect(service.drain(['project/object.pdf'])).resolves.toEqual({
      deleted: 1,
      pending: 0,
    });
    expect(prisma.storageDeletionJob.delete).toHaveBeenCalledWith({ where: { id: 'job-1' } });
  });

  it('keeps and annotates a job when object storage is unavailable', async () => {
    const prisma = {
      storageDeletionJob: {
        findMany: vi.fn().mockResolvedValue([{ id: 'job-1', objectKey: 'object' }]),
        delete: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const storage = { deletePhysical: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    const service = new StorageDeletionService(prisma as never, storage as never);

    await expect(service.drain()).resolves.toEqual({ deleted: 0, pending: 1 });
    expect(prisma.storageDeletionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { attempts: { increment: 1 }, lastError: 'Unavailable' },
    });
  });
});
