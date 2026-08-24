import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TrackerTrashService } from './tracker-trash.service';

const userId = 'user-id';
const trackerId = 'tracker-id';

function service(
  remove: ReturnType<typeof vi.fn>,
  prisma: object = {},
  directManagementMembership: ReturnType<typeof vi.fn> = vi.fn(),
) {
  const evictTracker = vi.fn().mockResolvedValue(undefined);
  return {
    svc: new TrackerTrashService(
      prisma as never,
      { directManagementMembership } as never,
      { remove } as never,
      { evictTracker } as never,
    ),
    remove,
    directManagementMembership,
    evictTracker,
  };
}

function refusedRemove() {
  return vi.fn().mockRejectedValue(new NotFoundException('Tracker not found'));
}

const managementMembership = {
  role: { permissions: [{ permission: 'manage_tracker_settings' }] },
};

describe('TrackerTrashService authorization', () => {
  it('trashes through S4 and evicts the tracker room only once removal succeeded', async () => {
    const remove = vi.fn().mockResolvedValue({ id: trackerId, deletedAt: new Date() });
    const { svc, evictTracker } = service(remove);

    const result = await svc.trash(userId, trackerId);

    // Authorization (direct-management `manage_tracker_settings`), the deletion triple, activity
    // metadata, and pending-invitation revocation are S4's; this wrapper only adds eviction.
    expect(remove).toHaveBeenCalledWith(userId, trackerId);
    expect(result.id).toBe(trackerId);
    expect(evictTracker).toHaveBeenCalledWith(trackerId);
  });

  it('does not evict when the trash itself is refused', async () => {
    const { svc, evictTracker } = service(
      vi.fn().mockRejectedValue(new ForbiddenException('Missing permission')),
    );

    await expect(svc.trash(userId, trackerId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(evictTracker).not.toHaveBeenCalled();
  });

  it('refuses restore/purge for a direct member without manage_tracker_settings', async () => {
    // A prisma double that fails loudly if any query runs before authorization.
    const prisma = {
      $transaction: vi.fn(() => {
        throw new Error('must not run when unauthorized');
      }),
      tracker: {
        findFirst: vi.fn(() => {
          throw new Error('must not run when unauthorized');
        }),
      },
    };
    const noManagementPermission = vi.fn().mockResolvedValue({ role: { permissions: [] } });
    const { svc } = service(vi.fn(), prisma, noManagementPermission);

    await expect(svc.restore(userId, trackerId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.purge(userId, trackerId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(noManagementPermission).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404s a Space-tier manager on trash, restore, and purge like any non-member', async () => {
    // `directManagementMembership` resolves a direct membership row or nothing: a manager whose
    // reach is projected from a Space tier has no such row, so the permission service 404s —
    // Space access grants working access to contents, never deletion authority.
    const prisma = {
      $transaction: vi.fn(() => {
        throw new Error('must not run when Space access is refused');
      }),
      tracker: {
        findFirst: vi.fn(() => {
          throw new Error('must not run when Space access is refused');
        }),
      },
    };
    const notFound = vi.fn().mockRejectedValue(new NotFoundException('Tracker not found'));
    const { svc } = service(refusedRemove(), prisma, notFound);

    await expect(svc.trash(userId, trackerId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.restore(userId, trackerId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.purge(userId, trackerId)).rejects.toBeInstanceOf(NotFoundException);
    // restore/purge consult `directManagementMembership` themselves; the trash verb inherits its
    // 404 from S4's own authorization inside `remove`, so only those two reach the permission
    // service here.
    expect(notFound).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('restores and purges once a direct manager is authorized', async () => {
    const tx = {
      tracker: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: trackerId, deletedAt: null }),
        delete: vi.fn(),
      },
      activityEvent: { deleteMany: vi.fn() },
      instanceInvitation: { deleteMany: vi.fn() },
      storageObject: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
      storageDeletionJob: { createMany: vi.fn() },
      trackerComment: { deleteMany: vi.fn() },
      trackerField: { deleteMany: vi.fn() },
      trackerFieldOption: { deleteMany: vi.fn() },
      trackerFieldValue: { deleteMany: vi.fn() },
      trackerFieldValueOption: { deleteMany: vi.fn() },
      trackerInvitation: { deleteMany: vi.fn() },
      trackerMembership: { deleteMany: vi.fn() },
      trackerRecord: { deleteMany: vi.fn() },
      trackerRole: {
        findMany: vi.fn().mockResolvedValue([{ id: 'role-1' }]),
        deleteMany: vi.fn(),
      },
      trackerUserWorkspaceLayout: { deleteMany: vi.fn() },
      trackerWorkspaceDefault: { deleteMany: vi.fn() },
    };
    const prisma = {
      // purgeTracker resolves the trashed row on the request-scoped client before its transaction.
      tracker: { findFirst: vi.fn().mockResolvedValue({ id: trackerId }) },
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const directManagementMembership = vi.fn().mockResolvedValue(managementMembership);
    const { svc } = service(vi.fn(), prisma, directManagementMembership);

    await expect(svc.restore(userId, trackerId)).resolves.toMatchObject({ id: trackerId });
    await expect(svc.purge(userId, trackerId)).resolves.toEqual({ purged: true });
    expect(directManagementMembership).toHaveBeenCalledWith(userId, trackerId);
    expect(directManagementMembership).toHaveBeenCalledTimes(2);
  });

  it('lists owner trash and runs the retention sweep without a permission check', async () => {
    const prisma = {
      tracker: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { svc } = service(vi.fn(), prisma);

    await expect(svc.listTrashed(userId)).resolves.toEqual([]);
    await expect(svc.purgeExpiredTrackers(new Date())).resolves.toBe(0);
  });
});
