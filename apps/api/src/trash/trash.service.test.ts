import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PostgresDatabaseCapabilities } from '../database/postgres-database-capabilities';
import { TrashService } from './trash.service';

const project = {
  id: 'project-id',
  ownerUserId: 'owner-id',
  deletedAt: null,
};

const storageDeletions = {
  drain: vi.fn().mockResolvedValue({ deleted: 0, pending: 0 }),
  triggerDrain: vi.fn(),
};

function serviceWith(storageObject: Record<string, unknown>) {
  const tx = {
    storageObject: { delete: vi.fn() },
    sourceDocument: { delete: vi.fn() },
    itemSourceReference: { deleteMany: vi.fn() },
    fieldValue: { count: vi.fn().mockResolvedValue(0) },
    storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    activityEvent: { create: vi.fn() },
    project: { update: vi.fn() },
  };
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue(project) },
    storageObject: { findFirst: vi.fn().mockResolvedValue(storageObject) },
    sourceDocument: { findFirst: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
  };
  const storage = { deletePhysical: vi.fn(), serialize: vi.fn((value: unknown) => value) };
  const service = new TrashService(
    prisma as never,
    {} as never,
    storage as never,
    storageDeletions as never,
    new PostgresDatabaseCapabilities(prisma as never),
  );
  return { service, prisma, storage, storageDeletions, tx };
}

describe('TrashService storage purging', () => {
  it('does not purge a storage object referenced by any active or trashed field value', async () => {
    const { service, storage, tx } = serviceWith({
      id: 'storage-id',
      projectId: project.id,
      deletedAt: new Date(),
      originalFilename: 'asset.png',
      objectKey: 'project-id/storage-id',
      _count: { fieldValues: 1 },
      sourceDocument: null,
    });

    await expect(
      service.purgeStorageObject(project.ownerUserId, project.id, 'storage-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.storageObject.delete).not.toHaveBeenCalled();
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });

  it('queues an unreferenced object for delayed deletion only after its transaction commits', async () => {
    const { service, prisma, storage, storageDeletions, tx } = serviceWith({
      id: 'storage-id',
      projectId: project.id,
      deletedAt: new Date(),
      originalFilename: 'asset.png',
      objectKey: 'project-id/storage-id',
      _count: { fieldValues: 0 },
      sourceDocument: null,
    });

    await expect(
      service.purgeStorageObject(project.ownerUserId, project.id, 'storage-id'),
    ).resolves.toEqual({ purged: true });
    expect(tx.storageObject.delete).toHaveBeenCalledWith({ where: { id: 'storage-id' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(storageDeletions.triggerDrain).toHaveBeenCalledWith();
    expect(storageDeletions.triggerDrain.mock.invocationCallOrder[0]).toBeGreaterThan(
      prisma.$transaction.mock.invocationCallOrder[0]!,
    );
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });
});

describe('TrashService item lifecycle', () => {
  it('trashes every active descendant in one recoverable batch and records activity', async () => {
    const tx = {
      breakdownItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'root', title: 'Root' }),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'child' }])
          .mockResolvedValueOnce([{ id: 'grandchild' }])
          .mockResolvedValueOnce([]),
        updateMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      activityEvent: { create: vi.fn() },
      project: { update: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new TrashService(
      prisma as never,
      permissions as never,
      {} as never,
      storageDeletions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    const result = await service.trashItem('actor', 'project-id', 'root');

    expect(result).toMatchObject({ count: 3, rootItemId: 'root' });
    expect(tx.breakdownItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['root', 'child', 'grandchild'] },
          projectId: 'project-id',
          deletedAt: null,
        },
      }),
    );
    expect(tx.activityEvent.create).toHaveBeenCalledWith({
      data: {
        projectId: 'project-id',
        actorId: 'actor',
        action: 'DELETED',
        resourceType: 'breakdown_item',
        resourceId: 'root',
        metadata: { batchId: result.batchId, count: 3, title: 'Root' },
      },
    });
  });

  it('restores a whole batch and refuses to orphan it under a trashed parent', async () => {
    const tx = {
      breakdownItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'child', parentId: 'parent', title: 'Child' },
          { id: 'grandchild', parentId: 'child', title: 'Grandchild' },
        ]),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
      activityEvent: { create: vi.fn() },
      project: { update: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new TrashService(
      prisma as never,
      permissions as never,
      {} as never,
      storageDeletions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await expect(service.restoreBatch('actor', 'project-id', 'batch')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.breakdownItem.updateMany).not.toHaveBeenCalled();
  });

  it('purges trashed descendants deepest-first for the project owner', async () => {
    const tx = {
      breakdownItem: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'child' }])
          .mockResolvedValueOnce([{ id: 'grandchild' }])
          .mockResolvedValueOnce([]),
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn(),
        delete: vi.fn(),
      },
      activityEvent: { create: vi.fn() },
      project: { update: vi.fn() },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue(project) },
      breakdownItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'root',
          projectId: project.id,
          deletedAt: new Date(),
          title: 'Root',
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new TrashService(
      prisma as never,
      {} as never,
      {} as never,
      storageDeletions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await expect(service.purgeItem(project.ownerUserId, project.id, 'root')).resolves.toEqual({
      purged: true,
      count: 3,
    });
    expect(tx.breakdownItem.deleteMany.mock.calls[0]?.[0]).toEqual({
      where: { id: { in: ['grandchild'] } },
    });
    expect(tx.breakdownItem.deleteMany.mock.calls[1]?.[0]).toEqual({
      where: { id: { in: ['child'] } },
    });
    expect(tx.breakdownItem.delete).toHaveBeenCalledWith({ where: { id: 'root' } });
  });
});

describe('TrashService field lifecycle', () => {
  it('requires the active field version when moving it to trash', async () => {
    const tx = {
      fieldDefinition: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
      activityEvent: { create: vi.fn() },
      project: { update: vi.fn() },
    };
    const prisma = {
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'field-id',
          projectId: 'project-id',
          name: 'Status',
          version: 4,
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new TrashService(
      prisma as never,
      permissions as never,
      {} as never,
      storageDeletions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await expect(
      service.trashField('actor', 'project-id', 'field-id', { version: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.activityEvent.create).not.toHaveBeenCalled();
    expect(tx.fieldDefinition.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('restores a field only once when restore requests race', async () => {
    const tx = {
      fieldDefinition: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
      activityEvent: { create: vi.fn() },
      project: { update: vi.fn() },
    };
    const prisma = {
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'field-id',
          projectId: 'project-id',
          name: 'Status',
          version: 5,
          deletedAt: new Date(),
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new TrashService(
      prisma as never,
      permissions as never,
      {} as never,
      storageDeletions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await expect(service.restoreField('actor', 'project-id', 'field-id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.activityEvent.create).not.toHaveBeenCalled();
  });
});

describe('TrashService project retention', () => {
  it("lists only the signed-in user's trashed projects and derives the purge deadline", async () => {
    const deletedAt = new Date('2026-07-01T00:00:00.000Z');
    const prisma = {
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'project-id',
            name: 'Project',
            ownerUserId: 'owner-id',
            deletedAt,
          },
        ]),
      },
    };
    const service = new TrashService(
      prisma as never,
      {} as never,
      {} as never,
      storageDeletions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    const result = await service.listTrashedProjects('owner-id');

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: { not: null }, memberships: { some: { userId: 'owner-id' } } },
      }),
    );
    expect(result[0]).toMatchObject({ canRestore: true, canPurge: true });
    expect(result[0]?.purgeAfter).toEqual(new Date('2026-07-31T00:00:00.000Z'));
  });

  it('does not reveal a trashed project to a non-owner attempting restoration', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new TrashService(
      prisma as never,
      {} as never,
      {} as never,
      storageDeletions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await expect(service.restoreProject('other-user', project.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
