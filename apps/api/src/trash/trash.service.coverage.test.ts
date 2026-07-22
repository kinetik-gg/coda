import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_PURGE_BATCH_SIZE, PROJECT_STORAGE_BATCH_SIZE } from './trash-project-purger';
import { TrashService } from './trash.service';

const activeProject = { id: 'project', ownerUserId: 'owner', deletedAt: null };

function serviceWith(
  prisma: object,
  permissionResult: object = { project: activeProject },
  storageDeletions = {
    drain: vi.fn().mockResolvedValue({ deleted: 0, pending: 0 }),
    triggerDrain: vi.fn(),
  },
) {
  const permissions = { assert: vi.fn().mockResolvedValue(permissionResult) };
  const storage = {
    serialize: vi.fn((value: object) => ({ ...value, serialized: true })),
    deletePhysical: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new TrashService(
      prisma as never,
      permissions as never,
      storage as never,
      storageDeletions as never,
    ),
    permissions,
    storage,
    storageDeletions,
  };
}

function transactionWith(tx: object, extra: object = {}) {
  const client = { $executeRaw: vi.fn().mockResolvedValue(1), ...tx };
  return {
    ...extra,
    $transaction: vi.fn((callback: (value: typeof client) => unknown) => callback(client)),
  };
}

function activityModels() {
  return {
    activityEvent: { create: vi.fn().mockResolvedValue({}) },
    project: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe('TrashService listing and project lifecycle', () => {
  it('lists every trash category and serializes storage objects', async () => {
    const prisma = {
      breakdownItem: { findMany: vi.fn().mockResolvedValue([{ id: 'item' }]) },
      fieldDefinition: { findMany: vi.fn().mockResolvedValue([{ id: 'field' }]) },
      sourceDocument: { findMany: vi.fn().mockResolvedValue([{ id: 'document' }]) },
      storageObject: { findMany: vi.fn().mockResolvedValue([{ id: 'storage' }]) },
    };
    const { service, permissions, storage } = serviceWith(prisma);
    await expect(service.list('user', 'project')).resolves.toEqual({
      items: [{ id: 'item' }],
      fields: [{ id: 'field' }],
      sourceDocuments: [{ id: 'document' }],
      storageObjects: [{ id: 'storage', serialized: true }],
    });
    expect(permissions.assert).toHaveBeenCalledWith('user', 'project', 'read_project');
    expect(storage.serialize).toHaveBeenCalledWith({ id: 'storage' });
  });

  it('allows only the owner to trash a project and derives its retention deadline', async () => {
    const deletedAt = new Date();
    const tx = {
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      project: { update: vi.fn().mockResolvedValue({ ...activeProject, deletedAt }) },
      projectInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      instanceInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith(transactionWith(tx));
    const result = await service.trashProject('owner', 'project');
    expect(result.purgeAfter?.getTime()).toBe(
      deletedAt.getTime() + TrashService.PROJECT_RETENTION_MS,
    );
    const trashActivity = tx.activityEvent.create.mock.calls[0]?.[0] as unknown as {
      data: { action: string; metadata: { purgeAfter: Date } };
    };
    expect(trashActivity.data.action).toBe('DELETED');
    expect(trashActivity.data.metadata.purgeAfter).toBeInstanceOf(Date);
    const projectUpdate = tx.project.update.mock.calls[0]![0] as unknown as {
      data: { deletedAt: Date };
    };
    expect(tx.projectInvitation.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project', status: 'PENDING', revokedAt: null },
      data: { status: 'REVOKED', revokedAt: projectUpdate.data.deletedAt },
    });
    expect(tx.instanceInvitation.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project', status: 'PENDING', revokedAt: null },
      data: { status: 'REVOKED', revokedAt: projectUpdate.data.deletedAt },
    });

    const forbidden = serviceWith({}, { project: { ownerUserId: 'another-user' } });
    await expect(forbidden.service.trashProject('user', 'project')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('restores a trashed project for its owner', async () => {
    const deleted = { ...activeProject, deletedAt: new Date() };
    const tx = {
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 'project' }),
        update: vi.fn().mockResolvedValue({ ...activeProject, version: 2 }),
      },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = transactionWith(tx, {
      project: { findUnique: vi.fn().mockResolvedValue(deleted) },
    });
    const { service } = serviceWith(prisma);
    await expect(service.restoreProject('owner', 'project')).resolves.toMatchObject({
      deletedAt: null,
      purgeAfter: null,
    });
    const restoreActivity = tx.activityEvent.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(restoreActivity.data).toMatchObject({ action: 'RESTORED', resourceType: 'project' });
  });

  it('purges an owned trashed project and then deletes each physical object', async () => {
    const project = {
      ...activeProject,
      deletedAt: new Date(),
      storageObjects: [{ objectKey: 'one' }, { objectKey: 'two' }],
    };
    const tx = {
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      fieldValueOption: { deleteMany: vi.fn().mockResolvedValue({}) },
      fieldValue: { deleteMany: vi.fn().mockResolvedValue({}) },
      itemSourceReference: { deleteMany: vi.fn().mockResolvedValue({}) },
      sourceDocument: { deleteMany: vi.fn().mockResolvedValue({}) },
      storageObject: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'storage-one', objectKey: 'one' },
          { id: 'storage-two', objectKey: 'two' },
        ]),
        deleteMany: vi.fn().mockResolvedValue({}),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue(project),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = transactionWith(tx, {
      project: { findUnique: vi.fn().mockResolvedValue(project) },
    });
    const { service, storage, storageDeletions } = serviceWith(prisma);
    await expect(service.purgeProject('owner', 'project')).resolves.toEqual({ purged: true });
    expect(storageDeletions.triggerDrain).toHaveBeenCalledWith();
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });

  it('commits durable storage deletion jobs before purging project metadata', async () => {
    const project = {
      ...activeProject,
      deletedAt: new Date(),
      storageObjects: [{ objectKey: 'one' }, { objectKey: 'two' }],
    };
    const tx = {
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      fieldValueOption: { deleteMany: vi.fn() },
      fieldValue: { deleteMany: vi.fn() },
      itemSourceReference: { deleteMany: vi.fn() },
      sourceDocument: { deleteMany: vi.fn() },
      storageObject: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'storage-one', objectKey: 'one' },
          { id: 'storage-two', objectKey: 'two' },
        ]),
        deleteMany: vi.fn(),
      },
      project: { findFirst: vi.fn().mockResolvedValue(project), delete: vi.fn() },
    };
    const prisma = transactionWith(tx, {
      project: { findUnique: vi.fn().mockResolvedValue(project) },
    });
    const deletions = {
      drain: vi.fn().mockResolvedValue({ deleted: 0, pending: 2 }),
      triggerDrain: vi.fn(),
    };
    const { service, storage } = serviceWith(prisma, { project: activeProject }, deletions);

    await expect(service.purgeProject('owner', 'project')).resolves.toEqual({ purged: true });
    const queued = tx.storageDeletionJob.createMany.mock.calls[0]?.[0] as unknown as {
      data: Array<{ projectId: string; objectKey: string; notBefore: Date }>;
      skipDuplicates: boolean;
    };
    expect(queued.skipDuplicates).toBe(true);
    expect(queued.data.map(({ projectId, objectKey }) => ({ projectId, objectKey }))).toEqual([
      { projectId: 'project', objectKey: 'one' },
      { projectId: 'project', objectKey: 'two' },
    ]);
    expect(queued.data.every(({ notBefore }) => notBefore instanceof Date)).toBe(true);
    expect(deletions.triggerDrain).toHaveBeenCalledWith();
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });

  it('pages project storage into bounded deletion-job batches before commit', async () => {
    const firstPage = Array.from({ length: PROJECT_STORAGE_BATCH_SIZE }, (_, index) => ({
      id: `storage-${String(index).padStart(3, '0')}`,
      objectKey: `object-${index}`,
    }));
    const finalObject = { id: 'storage-100', objectKey: 'object-100' };
    const storageFindMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([finalObject]);
    const tx = {
      $executeRaw: vi.fn(),
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      fieldValueOption: { deleteMany: vi.fn() },
      fieldValue: { deleteMany: vi.fn() },
      itemSourceReference: { deleteMany: vi.fn() },
      sourceDocument: { deleteMany: vi.fn() },
      storageObject: { findMany: storageFindMany, deleteMany: vi.fn() },
      project: { findFirst: vi.fn().mockResolvedValue({ id: 'project' }), delete: vi.fn() },
    };
    const committed = vi.fn();
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<boolean>) => {
        const result = await operation(tx);
        committed();
        return result;
      }),
    };
    const { service, storageDeletions } = serviceWith(prisma);

    await expect(service.purgeProject('owner', 'project')).resolves.toEqual({ purged: true });

    expect(storageFindMany).toHaveBeenCalledTimes(2);
    expect(storageFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { projectId: 'project' },
      orderBy: { id: 'asc' },
      take: PROJECT_STORAGE_BATCH_SIZE,
    });
    expect(storageFindMany.mock.calls[1]?.[0]).toMatchObject({
      where: { projectId: 'project', id: { gt: firstPage.at(-1)!.id } },
    });
    const queuedPages = tx.storageDeletionJob.createMany.mock.calls.map(
      ([input]) => (input as { data: unknown[] }).data.length,
    );
    expect(queuedPages).toEqual([PROJECT_STORAGE_BATCH_SIZE, 1]);
    expect(storageDeletions.triggerDrain).toHaveBeenCalledWith();
    expect(storageDeletions.triggerDrain.mock.invocationCallOrder[0]).toBeGreaterThan(
      committed.mock.invocationCallOrder[0]!,
    );
  });

  it.each([null, null, null])('rejects unauthorized or active project purging %#', async () => {
    const tx = { project: { findFirst: vi.fn().mockResolvedValue(null) } };
    const { service } = serviceWith(transactionWith(tx));
    await expect(service.purgeProject('owner', 'project')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('purges all projects older than the retention cutoff', async () => {
    const tx = {
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      fieldValueOption: { deleteMany: vi.fn() },
      fieldValue: { deleteMany: vi.fn() },
      itemSourceReference: { deleteMany: vi.fn() },
      sourceDocument: { deleteMany: vi.fn() },
      storageObject: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'storage-one', objectKey: 'one' }])
          .mockResolvedValueOnce([]),
        deleteMany: vi.fn(),
      },
      project: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'one', storageObjects: [{ objectKey: 'one' }] })
          .mockResolvedValueOnce({ id: 'two', storageObjects: [] }),
        delete: vi.fn(),
      },
    };
    const findMany = vi.fn().mockResolvedValue([
      { id: 'one', storageObjects: [{ objectKey: 'one' }] },
      { id: 'two', storageObjects: [] },
    ]);
    const { service, storage, storageDeletions } = serviceWith(
      transactionWith(tx, { project: { findMany } }),
    );
    const now = new Date('2026-07-22T00:00:00.000Z');
    await expect(service.purgeExpiredProjects(now)).resolves.toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: { lte: new Date(now.getTime() - TrashService.PROJECT_RETENTION_MS) } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    expect(storageDeletions.triggerDrain).toHaveBeenCalledTimes(2);
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });

  it('continues retention cleanup across bounded project pages', async () => {
    const firstPage = Array.from({ length: PROJECT_PURGE_BATCH_SIZE }, (_, index) => ({
      id: `project-${String(index).padStart(3, '0')}`,
    }));
    const finalProject = { id: 'project-100' };
    const findMany = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([finalProject]);
    const tx = {
      $executeRaw: vi.fn(),
      storageDeletionJob: { createMany: vi.fn() },
      fieldValueOption: { deleteMany: vi.fn() },
      fieldValue: { deleteMany: vi.fn() },
      itemSourceReference: { deleteMany: vi.fn() },
      sourceDocument: { deleteMany: vi.fn() },
      storageObject: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
      project: { findFirst: vi.fn().mockResolvedValue({ id: 'project' }), delete: vi.fn() },
    };
    const { service, storageDeletions } = serviceWith(
      transactionWith(tx, { project: { findMany } }),
    );

    await expect(service.purgeExpiredProjects(new Date('2026-07-22T00:00:00.000Z'))).resolves.toBe(
      PROJECT_PURGE_BATCH_SIZE + 1,
    );
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { id: { gt: firstPage.at(-1)!.id } },
      take: PROJECT_PURGE_BATCH_SIZE,
    });
    expect(storageDeletions.triggerDrain).toHaveBeenCalledTimes(PROJECT_PURGE_BATCH_SIZE + 1);
  });

  it('skips a retention candidate restored before the locked eligibility check', async () => {
    const deleteProject = vi.fn();
    const tx = {
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      project: { findFirst: vi.fn().mockResolvedValue(null), delete: deleteProject },
    };
    const findMany = vi.fn().mockResolvedValue([{ id: 'restored-project' }]);
    const { service, storage } = serviceWith(transactionWith(tx, { project: { findMany } }));

    await expect(service.purgeExpiredProjects(new Date('2026-07-22T00:00:00.000Z'))).resolves.toBe(
      0,
    );
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.project.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(deleteProject).not.toHaveBeenCalled();
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });
});

describe('TrashService item and field lifecycle', () => {
  it('restores a root deletion batch', async () => {
    const tx = {
      breakdownItem: {
        findMany: vi.fn().mockResolvedValue([{ id: 'root', parentId: null, title: 'Root' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      ...activityModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(service.restoreBatch('user', 'project', 'batch')).resolves.toEqual({
      restored: 1,
      rootItemId: 'root',
    });
  });

  it('rejects a missing item and missing deletion batch', async () => {
    const trashTx = { breakdownItem: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(
      serviceWith(transactionWith(trashTx)).service.trashItem('user', 'project', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const restoreTx = { breakdownItem: { findMany: vi.fn().mockResolvedValue([]) } };
    await expect(
      serviceWith(transactionWith(restoreTx)).service.restoreBatch('user', 'project', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects item purge by a non-owner, for an absent item, or with active descendants', async () => {
    const nonOwner = serviceWith({
      project: { findUnique: vi.fn().mockResolvedValue({ ownerUserId: 'other' }) },
    });
    await expect(nonOwner.service.purgeItem('owner', 'project', 'item')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const missing = serviceWith({
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      breakdownItem: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(missing.service.purgeItem('owner', 'project', 'item')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const tx = {
      breakdownItem: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'child' }])
          .mockResolvedValueOnce([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'active-child' }),
      },
    };
    const activeDescendant = serviceWith(
      transactionWith(tx, {
        project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
        breakdownItem: { findFirst: vi.fn().mockResolvedValue({ id: 'item', title: 'Item' }) },
      }),
    );
    await expect(
      activeDescendant.service.purgeItem('owner', 'project', 'item'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('trashes, restores, and purges a field across independent requests', async () => {
    const field = { id: 'field', name: 'Status', version: 1, deletedAt: null };
    const trashTx = {
      fieldDefinition: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...field, deletedAt: new Date(), version: 2 }),
      },
      ...activityModels(),
    };
    const trashPrisma = transactionWith(trashTx, {
      fieldDefinition: { findFirst: vi.fn().mockResolvedValue(field) },
    });
    const trashed = await serviceWith(trashPrisma).service.trashField('user', 'project', 'field', {
      version: 1,
    });
    expect(trashed.batchId).toEqual(expect.any(String));

    const deletedField = { ...field, deletedAt: new Date(), version: 2 };
    const restoreTx = {
      fieldDefinition: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...field, version: 3 }),
      },
      ...activityModels(),
    };
    const restorePrisma = transactionWith(restoreTx, {
      fieldDefinition: { findFirst: vi.fn().mockResolvedValue(deletedField) },
    });
    await expect(
      serviceWith(restorePrisma).service.restoreField('user', 'project', 'field'),
    ).resolves.toMatchObject({ version: 3 });

    const purgeTx = { fieldDefinition: { delete: vi.fn() }, ...activityModels() };
    const purgePrisma = transactionWith(purgeTx, {
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      fieldDefinition: { findFirst: vi.fn().mockResolvedValue(deletedField) },
    });
    await expect(
      serviceWith(purgePrisma).service.purgeField('owner', 'project', 'field'),
    ).resolves.toEqual({ purged: true });
  });

  it.each([
    [
      'trashField',
      { fieldDefinition: { findFirst: vi.fn().mockResolvedValue(null) } },
      NotFoundException,
    ],
    [
      'restoreField',
      { fieldDefinition: { findFirst: vi.fn().mockResolvedValue(null) } },
      NotFoundException,
    ],
  ])('rejects absent fields in %s', async (method, prisma, errorType) => {
    const service = serviceWith(prisma).service;
    const operation =
      method === 'trashField'
        ? service.trashField('user', 'project', 'field', { version: 1 })
        : service.restoreField('user', 'project', 'field');
    await expect(operation).rejects.toBeInstanceOf(errorType);
  });
});

describe('TrashService source-document and storage-object lifecycle', () => {
  it('trashes and restores a source document together with its backing object', async () => {
    const document = {
      id: 'document',
      title: 'Script',
      storageObjectId: 'storage',
      deletedAt: null,
      storageObject: { id: 'storage' },
    };
    const trashTx = {
      sourceDocument: { update: vi.fn().mockResolvedValue({ ...document, deletedAt: new Date() }) },
      storageObject: { update: vi.fn().mockResolvedValue({}) },
      ...activityModels(),
    };
    const trashPrisma = transactionWith(trashTx, {
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      sourceDocument: { findFirst: vi.fn().mockResolvedValue(document) },
    });
    const trashed = await serviceWith(trashPrisma).service.trashSourceDocument(
      'owner',
      'project',
      'document',
    );
    expect(trashed.batchId).toEqual(expect.any(String));
    expect(trashTx.storageObject.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'storage' } }),
    );

    const restoreTx = {
      sourceDocument: { update: vi.fn().mockResolvedValue(document) },
      storageObject: { update: vi.fn().mockResolvedValue({}) },
      ...activityModels(),
    };
    const restorePrisma = transactionWith(restoreTx, {
      sourceDocument: {
        findFirst: vi.fn().mockResolvedValue({ ...document, deletedAt: new Date() }),
      },
    });
    await expect(
      serviceWith(restorePrisma).service.restoreSourceDocument('user', 'project', 'document'),
    ).resolves.toEqual(document);
  });

  it('purges an unreferenced source document and its physical backing object', async () => {
    const document = {
      id: 'document',
      title: 'Script',
      storageObjectId: 'storage',
      deletedAt: new Date(),
      storageObject: { id: 'storage', deletedAt: new Date(), objectKey: 'script.pdf' },
    };
    const tx = {
      storageDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      itemSourceReference: { deleteMany: vi.fn() },
      sourceDocument: { delete: vi.fn() },
      fieldValue: { count: vi.fn().mockResolvedValue(0) },
      storageObject: { delete: vi.fn() },
      ...activityModels(),
    };
    const prisma = transactionWith(tx, {
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      sourceDocument: { findFirst: vi.fn().mockResolvedValue(document) },
    });
    const { service, storage, storageDeletions } = serviceWith(prisma);
    await expect(service.purgeSourceDocument('owner', 'project', 'document')).resolves.toEqual({
      purged: true,
      storageObjectPurged: true,
    });
    expect(storageDeletions.triggerDrain).toHaveBeenCalledWith();
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });

  it('retains a source document backing object that still has field references', async () => {
    const document = {
      id: 'document',
      title: 'Script',
      storageObjectId: 'storage',
      deletedAt: new Date(),
      storageObject: { id: 'storage', deletedAt: new Date(), objectKey: 'script.pdf' },
    };
    const tx = {
      itemSourceReference: { deleteMany: vi.fn() },
      sourceDocument: { delete: vi.fn() },
      fieldValue: { count: vi.fn().mockResolvedValue(1) },
      storageObject: { delete: vi.fn() },
      ...activityModels(),
    };
    const prisma = transactionWith(tx, {
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      sourceDocument: { findFirst: vi.fn().mockResolvedValue(document) },
    });
    const { service, storage } = serviceWith(prisma);
    await expect(
      service.purgeSourceDocument('owner', 'project', 'document'),
    ).resolves.toMatchObject({ storageObjectPurged: false });
    expect(storage.deletePhysical).not.toHaveBeenCalled();
  });

  it('trashes and restores an unlinked ordinary storage object', async () => {
    const object = {
      id: 'storage',
      kind: 'FILE',
      sourceDocument: null,
      originalFilename: 'asset.exr',
      objectKey: 'asset',
    };
    const trashTx = {
      storageObject: { update: vi.fn().mockResolvedValue(object) },
      ...activityModels(),
    };
    const trashPrisma = transactionWith(trashTx, {
      storageObject: { findFirst: vi.fn().mockResolvedValue(object) },
    });
    const { service: trashService, permissions } = serviceWith(trashPrisma);
    await expect(
      trashService.trashStorageObject('user', 'project', 'storage'),
    ).resolves.toMatchObject({ id: 'storage', serialized: true });
    expect(permissions.assert).toHaveBeenCalledWith('user', 'project', 'manage_storage_objects');

    const deleted = { ...object, deletedAt: new Date() };
    const restoreTx = {
      storageObject: { update: vi.fn().mockResolvedValue(object) },
      ...activityModels(),
    };
    const restorePrisma = transactionWith(restoreTx, {
      storageObject: { findFirst: vi.fn().mockResolvedValue(deleted) },
    });
    await expect(
      serviceWith(restorePrisma).service.restoreStorageObject('user', 'project', 'storage'),
    ).resolves.toMatchObject({ id: 'storage', serialized: true });
  });

  it('uses document permission and rejects linked-object lifecycle shortcuts', async () => {
    const sourceObject = {
      id: 'storage',
      kind: 'SOURCE_DOCUMENT',
      sourceDocument: { id: 'document', deletedAt: new Date() },
    };
    const trash = serviceWith({
      storageObject: { findFirst: vi.fn().mockResolvedValue(sourceObject) },
    });
    await expect(
      trash.service.trashStorageObject('user', 'project', 'storage'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(trash.permissions.assert).toHaveBeenCalledWith(
      'user',
      'project',
      'manage_source_documents',
    );

    const restore = serviceWith({
      storageObject: {
        findFirst: vi.fn().mockResolvedValue({ ...sourceObject, deletedAt: new Date() }),
      },
    });
    await expect(
      restore.service.restoreStorageObject('user', 'project', 'storage'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['trashStorageObject', 'Storage object not found'],
    ['restoreStorageObject', 'Trashed storage object not found'],
  ])('rejects absent objects in %s', async (method, message) => {
    const service = serviceWith({
      storageObject: { findFirst: vi.fn().mockResolvedValue(null) },
    }).service;
    const operation =
      method === 'trashStorageObject'
        ? service.trashStorageObject('user', 'project', 'missing')
        : service.restoreStorageObject('user', 'project', 'missing');
    await expect(operation).rejects.toThrow(message);
  });

  it('rejects purging an absent or referenced storage object', async () => {
    const missing = serviceWith({
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      storageObject: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      missing.service.purgeStorageObject('owner', 'project', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const referenced = serviceWith({
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      storageObject: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ _count: { fieldValues: 0 }, sourceDocument: { id: 'doc' } }),
      },
    });
    await expect(
      referenced.service.purgeStorageObject('owner', 'project', 'storage'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['trashSourceDocument', 'Source document not found'],
    ['restoreSourceDocument', 'Trashed source document not found'],
    ['purgeSourceDocument', 'Trashed source document not found'],
  ])('rejects absent source documents in %s', async (method, message) => {
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue(activeProject) },
      sourceDocument: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = serviceWith(prisma).service;
    const operation =
      method === 'trashSourceDocument'
        ? service.trashSourceDocument('owner', 'project', 'missing')
        : method === 'restoreSourceDocument'
          ? service.restoreSourceDocument('owner', 'project', 'missing')
          : service.purgeSourceDocument('owner', 'project', 'missing');
    await expect(operation).rejects.toThrow(message);
  });
});
