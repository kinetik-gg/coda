import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_RETENTION_MS } from './trash-project-purger';
import {
  TRACKER_RETENTION_MS,
  listTrashedTrackers,
  purgeExpiredTrackers,
  purgeTracker,
  restoreTracker,
  serializeTrackerTrash,
  trackerPurgeAfter,
} from './trash-tracker';

const trashedRow = {
  id: 'tracker-id',
  ownerUserId: 'owner-id',
  name: 'Continuity',
  description: null,
  version: 3,
  revision: 5,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  deletedAt: new Date('2026-08-03T00:00:00.000Z'),
  deletedById: 'owner-id',
  deletionBatchId: 'batch-id',
};

/** One prisma model double: every method is a vi.fn. */
type ModelMock = Record<string, ReturnType<typeof vi.fn>>;

/**
 * Prisma double whose `$transaction(cb)` runs the callback against the same client and records
 * every model method invocation in a shared log, so purge-ordering assertions read as a literal
 * deletion sequence.
 */
function prismaDouble(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const tracked = (name: string, resolved: unknown = { count: 1 }) =>
    vi.fn().mockImplementation(() => {
      calls.push(name);
      return Promise.resolve(resolved);
    });
  const client: Record<string, unknown> = {
    tracker: {
      updateMany: tracked('tracker.updateMany'),
      findFirstOrThrow: vi.fn().mockResolvedValue(trashedRow),
      findFirst: vi.fn().mockResolvedValue({ id: 'tracker-id' }),
      findMany: vi.fn().mockResolvedValue([]),
      delete: tracked('tracker.delete', trashedRow),
    },
    trackerField: { deleteMany: tracked('trackerField.deleteMany') },
    trackerFieldOption: { deleteMany: tracked('trackerFieldOption.deleteMany') },
    trackerRecord: { deleteMany: tracked('trackerRecord.deleteMany') },
    trackerFieldValue: { deleteMany: tracked('trackerFieldValue.deleteMany') },
    trackerFieldValueOption: { deleteMany: tracked('trackerFieldValueOption.deleteMany') },
    trackerComment: { deleteMany: tracked('trackerComment.deleteMany') },
    trackerWorkspaceDefault: { deleteMany: tracked('trackerWorkspaceDefault.deleteMany') },
    trackerUserWorkspaceLayout: { deleteMany: tracked('trackerUserWorkspaceLayout.deleteMany') },
    activityEvent: { deleteMany: tracked('activityEvent.deleteMany') },
    trackerRole: {
      findMany: vi.fn().mockResolvedValue([{ id: 'role-1' }, { id: 'role-2' }]),
      deleteMany: tracked('trackerRole.deleteMany'),
    },
    trackerInvitation: { deleteMany: tracked('trackerInvitation.deleteMany') },
    trackerMembership: { deleteMany: tracked('trackerMembership.deleteMany') },
    instanceInvitation: { deleteMany: tracked('instanceInvitation.deleteMany') },
    // One owned object by default so the enqueue helper records its outbox write first.
    storageObject: {
      findMany: vi.fn().mockResolvedValue([{ objectKey: 'trackers/tracker-id/upload' }]),
      deleteMany: tracked('storageObject.deleteMany'),
    },
    storageDeletionJob: { createMany: tracked('storageDeletionJob.createMany', { count: 0 }) },
    ...overrides,
  };
  client.$transaction = vi.fn((callback: (tx: typeof client) => unknown) =>
    Promise.resolve(callback(client)),
  );
  return {
    client: client as never,
    model: (name: string): ModelMock => client[name] as ModelMock,
    calls,
  };
}

describe('tracker retention window', () => {
  it('matches the project retention window exactly', () => {
    expect(TRACKER_RETENTION_MS).toBe(PROJECT_RETENTION_MS);
    expect(TRACKER_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it('computes purgeAfter as deletedAt plus the retention window', () => {
    const deletedAt = new Date('2026-08-03T00:00:00.000Z');
    expect(trackerPurgeAfter(deletedAt).getTime()).toBe(deletedAt.getTime() + TRACKER_RETENTION_MS);
    expect(serializeTrackerTrash({ deletedAt: null }).purgeAfter).toBeNull();
    expect(serializeTrackerTrash({ deletedAt }).purgeAfter).toEqual(trackerPurgeAfter(deletedAt));
  });
});

describe('restoreTracker', () => {
  it('clears the soft-delete columns and bumps version AND revision like the trash did', async () => {
    const { client, model } = prismaDouble({
      tracker: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ ...trashedRow, deletedAt: null }),
      },
    });
    const result = await restoreTracker(client, 'tracker-id');

    expect(model('tracker').updateMany).toHaveBeenCalledWith({
      where: { id: 'tracker-id', deletedAt: { not: null } },
      data: {
        deletedAt: null,
        deletedById: null,
        deletionBatchId: null,
        version: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    expect(result.purgeAfter).toBeNull();
  });

  it('throws NotFound when the tracker is not trashed', async () => {
    const { client } = prismaDouble({
      tracker: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirstOrThrow: vi.fn(),
      },
    });
    await expect(restoreTracker(client, 'tracker-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('purgeTracker', () => {
  it('hard-deletes every child family table explicitly before the tracker row', async () => {
    const { client, calls } = prismaDouble();

    await expect(purgeTracker(client, 'tracker-id')).resolves.toEqual({ purged: true });

    // Every child table in one literal sequence: blob keys enqueued first, then content children
    // (child rows before parents that would cascade them), layouts, activity, the role graph with
    // its embedded instance invitations, storage-object rows, and finally the tracker itself.
    expect(calls).toEqual([
      'storageDeletionJob.createMany',
      'trackerFieldValueOption.deleteMany',
      'trackerFieldValue.deleteMany',
      'trackerComment.deleteMany',
      'trackerRecord.deleteMany',
      'trackerFieldOption.deleteMany',
      'trackerField.deleteMany',
      'trackerWorkspaceDefault.deleteMany',
      'trackerUserWorkspaceLayout.deleteMany',
      'activityEvent.deleteMany',
      'instanceInvitation.deleteMany',
      'trackerInvitation.deleteMany',
      'trackerMembership.deleteMany',
      'trackerRole.deleteMany',
      'storageObject.deleteMany',
      'tracker.delete',
    ]);
  });

  it('scopes every explicit delete to the tracker', async () => {
    const { client, model } = prismaDouble();

    await purgeTracker(client, 'tracker-id');

    expect(model('trackerRecord').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('trackerField').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('trackerWorkspaceDefault').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('trackerUserWorkspaceLayout').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('activityEvent').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('trackerInvitation').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('trackerMembership').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('trackerRole').deleteMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
    });
    expect(model('tracker').delete).toHaveBeenCalledWith({ where: { id: 'tracker-id' } });
  });

  it('clears values and comments through their record relation, options through their field', async () => {
    const { client, model } = prismaDouble();

    await purgeTracker(client, 'tracker-id');

    expect(model('trackerFieldValueOption').deleteMany).toHaveBeenCalledWith({
      where: { fieldValue: { record: { trackerId: 'tracker-id' } } },
    });
    expect(model('trackerFieldValue').deleteMany).toHaveBeenCalledWith({
      where: { record: { trackerId: 'tracker-id' } },
    });
    expect(model('trackerComment').deleteMany).toHaveBeenCalledWith({
      where: { record: { trackerId: 'tracker-id' } },
    });
    expect(model('trackerFieldOption').deleteMany).toHaveBeenCalledWith({
      where: { field: { trackerId: 'tracker-id' } },
    });
  });

  it('removes embedded instance invitations by tracker id and by embedded role ids', async () => {
    const { client, model, calls } = prismaDouble();

    await purgeTracker(client, 'tracker-id');

    // Roles are read inside the same transaction so invitations embedding a tracker ROLE are
    // caught even though they restrict role deletion; the clause runs before the roles go.
    expect(model('trackerRole').findMany).toHaveBeenCalledWith({
      where: { trackerId: 'tracker-id' },
      select: { id: true },
    });
    expect(model('instanceInvitation').deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ trackerId: 'tracker-id' }, { trackerRoleId: { in: ['role-1', 'role-2'] } }] },
    });
    expect(calls.indexOf('instanceInvitation.deleteMany')).toBeLessThan(
      calls.indexOf('trackerRole.deleteMany'),
    );
  });

  it('enqueues every owned object key for outbox deletion before any row disappears', async () => {
    const objects = [
      { objectKey: 'trackers/tracker-id/upload-a' },
      { objectKey: 'trackers/tracker-id/upload-b' },
    ];
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const firstDelete = vi.fn().mockResolvedValue({ count: 1 });
    const { client } = prismaDouble({
      storageObject: { findMany: vi.fn().mockResolvedValue(objects), deleteMany: vi.fn() },
      storageDeletionJob: { createMany },
      trackerFieldValueOption: { deleteMany: firstDelete },
    });

    await purgeTracker(client, 'tracker-id');

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          projectId: null,
          trackerId: 'tracker-id',
          objectKey: 'trackers/tracker-id/upload-a',
          notBefore: expect.any(Date) as Date,
        },
        {
          projectId: null,
          trackerId: 'tracker-id',
          objectKey: 'trackers/tracker-id/upload-b',
          notBefore: expect.any(Date) as Date,
        },
      ],
      skipDuplicates: true,
    });
    // The outbox write is the very first statement of the purge transaction — before any child
    // table loses a row that records an object key.
    expect(createMany.mock.invocationCallOrder[0]).toBeLessThan(
      firstDelete.mock.invocationCallOrder[0] as number,
    );
  });

  it('throws NotFound and deletes nothing when no trashed tracker matches', async () => {
    const { client, model, calls } = prismaDouble({
      tracker: {
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn(),
        delete: vi.fn(),
      },
    });
    await expect(purgeTracker(client, 'tracker-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(model('tracker').delete).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('listTrashedTrackers', () => {
  it('returns owner-scoped trashed rows with purge deadlines and permissions', async () => {
    const findMany = vi.fn().mockResolvedValue([trashedRow]);
    const { client } = prismaDouble({ tracker: { findMany } });

    const result = await listTrashedTrackers(client, 'owner-id');

    expect(findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'owner-id', deletedAt: { not: null } },
      select: expect.anything() as unknown,
      orderBy: { deletedAt: 'desc' },
    });
    expect(result).toEqual([
      {
        ...trashedRow,
        purgeAfter: trackerPurgeAfter(trashedRow.deletedAt),
        canRestore: true,
        canPurge: true,
      },
    ]);
  });
});

describe('purgeExpiredTrackers', () => {
  it('purges every tracker deleted before the cutoff through the full child sweep', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([]);
    const { client, model } = prismaDouble({ tracker: { findMany, delete: vi.fn() } });
    const now = new Date('2026-09-05T00:00:00.000Z');

    const purged = await purgeExpiredTrackers(client, now);

    expect(purged).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: { lte: new Date(now.getTime() - TRACKER_RETENTION_MS) } },
      }),
    );
    expect(model('tracker').delete).toHaveBeenCalledTimes(2);
    expect(model('activityEvent').deleteMany).toHaveBeenCalledTimes(2);
  });

  it('continues past a tracker whose purge fails and reports the survivors', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    const failingValues = vi
      .fn()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValue({ count: 0 });
    const { client, model } = prismaDouble({
      tracker: { findMany, delete: vi.fn() },
      trackerFieldValue: { deleteMany: failingValues },
    });

    const purged = await purgeExpiredTrackers(client, new Date());

    expect(purged).toBe(1);
    expect(model('tracker').delete).toHaveBeenCalledTimes(1);
  });
});
