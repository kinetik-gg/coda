import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayTrashService } from './screenplay-trash.service';

const userId = 'user-id';
const screenplayId = 'screenplay-id';

function service(assert: ReturnType<typeof vi.fn>, prisma: object = {}) {
  const evictScreenplay = vi.fn().mockResolvedValue(undefined);
  return {
    svc: new ScreenplayTrashService(
      prisma as never,
      { assert } as never,
      {
        evictScreenplay,
      } as never,
    ),
    assert,
    evictScreenplay,
  };
}

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
    const { svc } = service(forbidden, prisma);

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
    expect(forbidden).toHaveBeenCalledTimes(3);
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
