import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_RETENTION_MS } from './trash-project-purger';
import {
  SCREENPLAY_RETENTION_MS,
  listTrashedScreenplays,
  purgeExpiredScreenplays,
  purgeScreenplay,
  restoreScreenplay,
  screenplayPurgeAfter,
  serializeScreenplayTrash,
  trashScreenplay,
} from './trash-screenplay';

const trashedRow = {
  id: 'screenplay-id',
  ownerUserId: 'owner-id',
  title: 'Blue Hour',
  filename: 'blue-hour.fountain',
  paperSize: 'letter',
  version: 2,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-02T00:00:00.000Z'),
  deletedAt: new Date('2026-07-03T00:00:00.000Z'),
  deletedById: 'owner-id',
  deletionBatchId: 'batch-id',
};

/** Prisma double whose `$transaction(cb)` runs the callback against the same client. */
function prismaDouble(overrides: Record<string, unknown> = {}) {
  const client: Record<string, unknown> = {
    screenplay: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: vi.fn().mockResolvedValue(trashedRow),
      findFirst: vi.fn().mockResolvedValue({ id: 'screenplay-id' }),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(trashedRow),
    },
    screenplayRevision: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    screenplayInvitation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    screenplayMembership: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    screenplayRole: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
    screenplayCollabUpdate: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    screenplayCollabCheckpoint: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    screenplayCommentThread: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    breakdownScreenplayLink: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    itemSourceRevisionPin: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ...overrides,
  };
  client.$transaction = vi.fn((callback: (tx: typeof client) => unknown) =>
    Promise.resolve(callback(client)),
  );
  return client;
}

describe('screenplay retention window', () => {
  it('matches the project retention window exactly', () => {
    expect(SCREENPLAY_RETENTION_MS).toBe(PROJECT_RETENTION_MS);
    expect(SCREENPLAY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it('computes purgeAfter as deletedAt plus the retention window', () => {
    const deletedAt = new Date('2026-07-03T00:00:00.000Z');
    expect(screenplayPurgeAfter(deletedAt).getTime()).toBe(
      deletedAt.getTime() + SCREENPLAY_RETENTION_MS,
    );
    expect(serializeScreenplayTrash({ deletedAt: null }).purgeAfter).toBeNull();
    expect(serializeScreenplayTrash({ deletedAt }).purgeAfter).toEqual(
      screenplayPurgeAfter(deletedAt),
    );
  });
});

describe('trashScreenplay', () => {
  it('soft-deletes an owned screenplay and returns it with a purge deadline', async () => {
    const prisma = prismaDouble();
    const updateMany = (prisma.screenplay as { updateMany: ReturnType<typeof vi.fn> }).updateMany;
    const result = await trashScreenplay(prisma as never, 'owner-id', 'screenplay-id');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'screenplay-id', deletedAt: null },
      data: {
        deletedAt: expect.any(Date) as Date,
        deletedById: 'owner-id',
        deletionBatchId: expect.any(String) as string,
        version: { increment: 1 },
      },
    });
    expect(result.purgeAfter).toEqual(screenplayPurgeAfter(trashedRow.deletedAt));
  });

  it('throws NotFound when nothing matches (missing, foreign, or already trashed)', async () => {
    const prisma = prismaDouble({
      screenplay: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirstOrThrow: vi.fn(),
      },
    });
    await expect(
      trashScreenplay(prisma as never, 'owner-id', 'screenplay-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('restoreScreenplay', () => {
  it('clears the soft-delete columns for an owned trashed screenplay', async () => {
    const prisma = prismaDouble({
      screenplay: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ ...trashedRow, deletedAt: null }),
      },
    });
    const updateMany = (prisma.screenplay as { updateMany: ReturnType<typeof vi.fn> }).updateMany;
    const result = await restoreScreenplay(prisma as never, 'screenplay-id');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'screenplay-id', deletedAt: { not: null } },
      data: {
        deletedAt: null,
        deletedById: null,
        deletionBatchId: null,
        version: { increment: 1 },
      },
    });
    expect(result.purgeAfter).toBeNull();
  });

  it('throws NotFound when the screenplay is not trashed', async () => {
    const prisma = prismaDouble({
      screenplay: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirstOrThrow: vi.fn(),
      },
    });
    await expect(restoreScreenplay(prisma as never, 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('purgeScreenplay', () => {
  it('hard-deletes the revisions before the screenplay for an owned trashed row', async () => {
    const prisma = prismaDouble();
    await expect(purgeScreenplay(prisma as never, 'screenplay-id')).resolves.toEqual({
      purged: true,
    });

    const revisions = prisma.screenplayRevision as { deleteMany: ReturnType<typeof vi.fn> };
    const screenplay = prisma.screenplay as { delete: ReturnType<typeof vi.fn> };
    const collabUpdates = prisma.screenplayCollabUpdate as { deleteMany: ReturnType<typeof vi.fn> };
    const collabCheckpoints = prisma.screenplayCollabCheckpoint as {
      deleteMany: ReturnType<typeof vi.fn>;
    };
    const commentThreads = prisma.screenplayCommentThread as {
      deleteMany: ReturnType<typeof vi.fn>;
    };
    expect(revisions.deleteMany).toHaveBeenCalledWith({ where: { screenplayId: 'screenplay-id' } });
    expect(screenplay.delete).toHaveBeenCalledWith({ where: { id: 'screenplay-id' } });
    // The collaboration log/checkpoint tables carry no FK onto screenplays (backup round-trip
    // convention), so their rows must be purged explicitly rather than by cascade.
    expect(collabUpdates.deleteMany).toHaveBeenCalledWith({
      where: { screenplayId: 'screenplay-id' },
    });
    expect(collabCheckpoints.deleteMany).toHaveBeenCalledWith({
      where: { screenplayId: 'screenplay-id' },
    });
    expect(commentThreads.deleteMany).toHaveBeenCalledWith({
      where: { screenplayId: 'screenplay-id' },
    });
    expect(revisions.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      screenplay.delete.mock.invocationCallOrder[0]!,
    );
  });

  it('leaves no breakdown following a purged screenplay', async () => {
    const prisma = prismaDouble();
    await purgeScreenplay(prisma as never, 'screenplay-id');

    // breakdown_screenplay_links has no FK onto screenplays either, so a purge that forgot this
    // line would strand every linked breakdown on a screenplay id that no longer resolves.
    expect(
      (prisma.breakdownScreenplayLink as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany,
    ).toHaveBeenCalledWith({ where: { screenplayId: 'screenplay-id' } });
  });

  it('throws NotFound when no trashed screenplay matches the owner', async () => {
    const prisma = prismaDouble({
      screenplay: {
        findFirst: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
    });
    await expect(purgeScreenplay(prisma as never, 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      (prisma.screenplay as { delete: ReturnType<typeof vi.fn> }).delete,
    ).not.toHaveBeenCalled();
  });
});

describe('listTrashedScreenplays', () => {
  it('returns owner-scoped trashed rows with purge deadlines and permissions', async () => {
    const prisma = prismaDouble({
      screenplay: { findMany: vi.fn().mockResolvedValue([trashedRow]) },
    });
    const findMany = (prisma.screenplay as { findMany: ReturnType<typeof vi.fn> }).findMany;
    const result = await listTrashedScreenplays(prisma as never, 'owner-id');

    expect(findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'owner-id', deletedAt: { not: null } },
      select: expect.anything() as unknown,
      orderBy: { deletedAt: 'desc' },
    });
    expect(result).toEqual([
      {
        ...trashedRow,
        purgeAfter: screenplayPurgeAfter(trashedRow.deletedAt),
        canRestore: true,
        canPurge: true,
      },
    ]);
  });
});

describe('purgeExpiredScreenplays', () => {
  it('purges every screenplay deleted before the cutoff, removing revisions first', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([]);
    const prisma = prismaDouble({ screenplay: { findMany, delete: vi.fn() } });
    // Two rows returned then an empty page: batch size (100) not reached, so it stops.
    const now = new Date('2026-09-01T00:00:00.000Z');
    const purged = await purgeExpiredScreenplays(prisma as never, now);

    expect(purged).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: { lte: new Date(now.getTime() - SCREENPLAY_RETENTION_MS) } },
      }),
    );
    const revisions = prisma.screenplayRevision as { deleteMany: ReturnType<typeof vi.fn> };
    expect(revisions.deleteMany).toHaveBeenCalledTimes(2);
    expect(
      (prisma.screenplay as { delete: ReturnType<typeof vi.fn> }).delete,
    ).toHaveBeenCalledTimes(2);
  });

  it('continues past a screenplay whose purge fails and reports the survivors', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    const deleteMany = vi
      .fn()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValue({ count: 0 });
    const prisma = prismaDouble({
      screenplay: { findMany, delete: vi.fn() },
      screenplayRevision: { deleteMany },
    });
    const purged = await purgeExpiredScreenplays(prisma as never, new Date());
    expect(purged).toBe(1);
  });
});
