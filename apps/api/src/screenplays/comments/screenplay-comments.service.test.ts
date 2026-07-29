import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayCommentsService } from './screenplay-comments.service';

const screenplayId = '10000000-0000-4000-8000-000000000010';
const userId = '10000000-0000-4000-8000-000000000011';
const otherUserId = '10000000-0000-4000-8000-000000000012';
const createdAt = new Date('2026-07-29T01:00:00.000Z');

interface PrismaStub {
  screenplay: { findUnique: ReturnType<typeof vi.fn> };
  screenplayCommentThread: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  screenplayComment: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: { findMany: ReturnType<typeof vi.fn> };
}

function comment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comment-id',
    threadId: 'thread-id',
    authorUserId: userId,
    body: 'A note',
    createdAt,
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-id',
    screenplayId,
    authorUserId: userId,
    anchorStart: Uint8Array.from([1, 2, 3]),
    anchorEnd: Uint8Array.from([4, 5, 6]),
    quotedText: 'Selected text',
    status: 'OPEN',
    resolvedAt: null,
    resolvedById: null,
    createdAt,
    updatedAt: createdAt,
    comments: [comment()],
    ...overrides,
  };
}

function prismaStub(): PrismaStub {
  return {
    screenplay: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null }) },
    screenplayCommentThread: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    screenplayComment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: userId, displayName: 'Ari' },
        { id: otherUserId, displayName: 'Bo' },
      ]),
    },
  };
}

function allowingPermissions() {
  return { assert: vi.fn().mockResolvedValue({ id: 'membership' }) };
}

function serviceWith(prisma: PrismaStub, permissions: object = allowingPermissions()) {
  return new ScreenplayCommentsService(prisma as never, permissions as never);
}

describe('ScreenplayCommentsService access and reads', () => {
  it('lists open threads as JSON-safe views after asserting read access', async () => {
    const prisma = prismaStub();
    prisma.screenplayCommentThread.findMany.mockResolvedValue([thread()]);
    const permissions = allowingPermissions();

    await expect(
      serviceWith(prisma, permissions).list(userId, screenplayId, { status: 'open' }),
    ).resolves.toMatchObject([
      {
        anchorStart: 'AQID',
        anchorEnd: 'BAUG',
        status: 'OPEN',
        author: { id: userId, displayName: 'Ari' },
        comments: [{ body: 'A note', author: { displayName: 'Ari' } }],
      },
    ]);
    expect(permissions.assert).toHaveBeenCalledWith(userId, screenplayId, 'read_screenplay');
    expect(prisma.screenplayCommentThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { screenplayId, status: 'OPEN' } }),
    );
  });

  it('supports resolved and all filters and redacts soft-deleted comment bodies', async () => {
    const prisma = prismaStub();
    prisma.screenplayCommentThread.findMany.mockResolvedValue([
      thread({ comments: [comment({ deletedAt: createdAt })] }),
    ]);
    const service = serviceWith(prisma);

    await expect(service.list(userId, screenplayId, { status: 'resolved' })).resolves.toMatchObject(
      [{ comments: [{ body: null, deletedAt: createdAt.toISOString() }] }],
    );
    expect(prisma.screenplayCommentThread.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { screenplayId, status: 'RESOLVED' } }),
    );

    await service.list(userId, screenplayId, { status: 'all' });
    expect(prisma.screenplayCommentThread.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { screenplayId } }),
    );
  });

  it('hides non-member and trashed screenplays before querying threads', async () => {
    const nonMemberPrisma = prismaStub();
    const permissions = {
      assert: vi.fn().mockRejectedValue(new NotFoundException('Screenplay not found')),
    };
    await expect(
      serviceWith(nonMemberPrisma, permissions).list(userId, screenplayId, { status: 'open' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(nonMemberPrisma.screenplayCommentThread.findMany).not.toHaveBeenCalled();

    const trashedPrisma = prismaStub();
    trashedPrisma.screenplay.findUnique.mockResolvedValue({ deletedAt: createdAt });
    await expect(
      serviceWith(trashedPrisma).list(userId, screenplayId, { status: 'open' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(trashedPrisma.screenplayCommentThread.findMany).not.toHaveBeenCalled();
  });
});

describe('ScreenplayCommentsService creation and replies', () => {
  it('lets a read-only member create a thread with binary anchors', async () => {
    const prisma = prismaStub();
    prisma.screenplayCommentThread.create.mockResolvedValue(thread());
    const permissions = allowingPermissions();

    await serviceWith(prisma, permissions).createThread(userId, screenplayId, {
      anchorStart: 'AQID',
      anchorEnd: 'BAUG',
      quotedText: 'Selected text',
      body: 'A note',
    });

    expect(permissions.assert).toHaveBeenCalledTimes(1);
    expect(permissions.assert).toHaveBeenCalledWith(userId, screenplayId, 'read_screenplay');
    const input = prisma.screenplayCommentThread.create.mock.calls[0]![0] as {
      data: { anchorStart: Uint8Array; anchorEnd: Uint8Array; comments: unknown };
    };
    expect([...input.data.anchorStart]).toEqual([1, 2, 3]);
    expect([...input.data.anchorEnd]).toEqual([4, 5, 6]);
    expect(input.data.comments).toEqual({
      create: { authorUserId: userId, body: 'A note' },
    });
  });

  it('lets a read-only member reply to an open thread', async () => {
    const prisma = prismaStub();
    prisma.screenplayCommentThread.findFirst.mockResolvedValue(thread());
    prisma.screenplayComment.create.mockResolvedValue(comment({ authorUserId: otherUserId }));

    await expect(
      serviceWith(prisma).reply(otherUserId, screenplayId, 'thread-id', 'A reply'),
    ).resolves.toMatchObject({ body: 'A note', author: { displayName: 'Bo' } });
    expect(prisma.screenplayComment.create).toHaveBeenCalledWith({
      data: { threadId: 'thread-id', authorUserId: otherUserId, body: 'A reply' },
    });
  });

  it('rejects replies to resolved or cross-screenplay threads', async () => {
    const resolvedPrisma = prismaStub();
    resolvedPrisma.screenplayCommentThread.findFirst.mockResolvedValue(
      thread({ status: 'RESOLVED' }),
    );
    await expect(
      serviceWith(resolvedPrisma).reply(userId, screenplayId, 'thread-id', 'Late reply'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const absentPrisma = prismaStub();
    absentPrisma.screenplayCommentThread.findFirst.mockResolvedValue(null);
    await expect(
      serviceWith(absentPrisma).reply(userId, screenplayId, 'other-thread', 'Nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
