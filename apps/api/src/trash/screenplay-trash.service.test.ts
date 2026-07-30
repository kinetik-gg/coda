import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayTrashService } from './screenplay-trash.service';

const userId = 'user-id';
const screenplayId = 'screenplay-id';

function service(
  assert: ReturnType<typeof vi.fn>,
  prisma: object = {},
  directManagementMembership: ReturnType<typeof vi.fn> = vi.fn(),
) {
  const evictScreenplay = vi.fn().mockResolvedValue(undefined);
  return {
    svc: new ScreenplayTrashService(
      prisma as never,
      { assert, directManagementMembership } as never,
      {
        evictScreenplay,
      } as never,
    ),
    assert,
    directManagementMembership,
    evictScreenplay,
  };
}

const managementMembership = {
  role: { permissions: [{ permission: 'manage_screenplay_settings' }] },
};

describe('ScreenplayTrashService authorization', () => {
  it('requires manage_screenplay_settings for trash, restore, and purge', async () => {
    // A prisma double that fails loudly if any query runs before authorization.
    const prisma = {
      $transaction: vi.fn(() => {
        throw new Error('must not run when unauthorized');
      }),
      screenplay: {
        findFirst: vi.fn(() => {
          throw new Error('must not run when unauthorized');
        }),
      },
    };
    const forbidden = vi.fn().mockRejectedValue(new ForbiddenException('Missing permission'));
    // restore/purge no longer route through `assert` (#263 — the choke point 404s a trashed
    // screenplay by design), so they authorize via `directManagementMembership` instead. A
    // membership with no `manage_screenplay_settings` permission reproduces the same 403.
    const noManagementPermission = vi.fn().mockResolvedValue({ role: { permissions: [] } });
    const { svc } = service(forbidden, prisma, noManagementPermission);

    await expect(svc.trashScreenplay(userId, screenplayId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.restoreScreenplay(userId, screenplayId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.purgeScreenplay(userId, screenplayId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(forbidden).toHaveBeenCalledWith(userId, screenplayId, 'manage_screenplay_settings');
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(noManagementPermission).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('propagates a non-member 404 from the permission service', async () => {
    const { svc } = service(
      vi.fn().mockRejectedValue(new NotFoundException('Screenplay not found')),
    );
    await expect(svc.trashScreenplay(userId, screenplayId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a Space-projected manager trashing a screenplay', async () => {
    const prisma = {
      $transaction: vi.fn(() => {
        throw new Error('must not run when Space access is refused');
      }),
    };
    const { svc, evictScreenplay } = service(
      vi.fn().mockResolvedValue({ spaceId: 'space-id' }),
      prisma,
    );

    await expect(svc.trashScreenplay(userId, screenplayId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(evictScreenplay).not.toHaveBeenCalled();
  });

  it('refuses restore/purge for a non-member — Space reach never grants direct management', async () => {
    // `directManagementMembership` only ever resolves a direct `screenplayMembership` row (there is
    // no Space-projected shape to reject here, unlike `trashScreenplay`'s `assert` path above) — a
    // Space-only manager has no such row, so the permission service 404s exactly like a non-member.
    const prisma = {
      screenplay: {
        findFirst: vi.fn(() => {
          throw new Error('must not run when unauthorized');
        }),
      },
    };
    const notFound = vi.fn().mockRejectedValue(new NotFoundException('Screenplay not found'));
    const { svc } = service(vi.fn(), prisma, notFound);

    await expect(svc.restoreScreenplay(userId, screenplayId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.purgeScreenplay(userId, screenplayId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('restores and purges once a direct manager is authorized', async () => {
    const tx = {
      screenplay: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: screenplayId, deletedAt: null }),
        delete: vi.fn(),
      },
      screenplayImportArtifact: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      storageDeletionJob: { createMany: vi.fn() },
      breakdownScreenplayLink: { deleteMany: vi.fn() },
      itemSourceRevisionPin: { deleteMany: vi.fn() },
      screenplayCollabUpdate: { deleteMany: vi.fn() },
      screenplayCollabCheckpoint: { deleteMany: vi.fn() },
      screenplayCommentThread: { deleteMany: vi.fn() },
      screenplayInvitation: { deleteMany: vi.fn() },
      screenplayMembership: { deleteMany: vi.fn() },
      screenplayRole: { deleteMany: vi.fn() },
      screenplayRevision: { deleteMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      screenplay: {
        findFirst: vi.fn().mockResolvedValue({ id: screenplayId }),
      },
    };
    const directManagementMembership = vi.fn().mockResolvedValue(managementMembership);
    const { svc } = service(vi.fn(), prisma, directManagementMembership);

    await expect(svc.restoreScreenplay(userId, screenplayId)).resolves.toMatchObject({
      id: screenplayId,
    });
    await expect(svc.purgeScreenplay(userId, screenplayId)).resolves.toEqual({ purged: true });
    expect(directManagementMembership).toHaveBeenCalledWith(userId, screenplayId);
    expect(directManagementMembership).toHaveBeenCalledTimes(2);
  });

  it('trashes once authorized, delegating to the soft-delete helper', async () => {
    const deletedAt = new Date('2026-07-25T00:00:00.000Z');
    const tx = {
      screenplay: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: screenplayId, deletedAt }),
      },
    };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const assert = vi.fn().mockResolvedValue({ id: 'membership' });
    const { svc, evictScreenplay } = service(assert, prisma);

    const result = await svc.trashScreenplay(userId, screenplayId);

    expect(assert).toHaveBeenCalledWith(userId, screenplayId, 'manage_screenplay_settings');
    expect(result.purgeAfter).not.toBeNull();
    // A trashed screenplay must reject a socket exactly like a non-member on its next join.
    expect(evictScreenplay).toHaveBeenCalledWith(screenplayId);
  });

  it('lists owner trash and runs the retention sweep without a permission check', async () => {
    const prisma = { screenplay: { findMany: vi.fn().mockResolvedValue([]) } };
    const assert = vi.fn();
    const { svc } = service(assert, prisma);

    await expect(svc.listTrashedScreenplays(userId)).resolves.toEqual([]);
    await expect(svc.purgeExpiredScreenplays(new Date())).resolves.toBe(0);
    expect(assert).not.toHaveBeenCalled();
  });
});
