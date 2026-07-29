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

describe('ScreenplayCommentsService comment mutations', () => {
  it('lets only the author edit a comment', async () => {
    const prisma = prismaStub();
    prisma.screenplayComment.findFirst.mockResolvedValue(comment());
    prisma.screenplayComment.update.mockResolvedValue(
      comment({ body: 'Revised', editedAt: createdAt }),
    );
    const service = serviceWith(prisma);

    await expect(
      service.updateComment(userId, screenplayId, 'comment-id', 'Revised'),
    ).resolves.toMatchObject({ body: 'Revised', editedAt: createdAt.toISOString() });
    expect(prisma.screenplayComment.update).toHaveBeenCalledWith({
      where: { id: 'comment-id' },
      data: { body: 'Revised', editedAt: expect.any(Date) },
    });

    prisma.screenplayComment.findFirst.mockResolvedValue(comment({ authorUserId: otherUserId }));
    await expect(
      service.updateComment(userId, screenplayId, 'comment-id', 'Not mine'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets authors delete their own comments using read access only', async () => {
    const prisma = prismaStub();
    prisma.screenplayComment.findFirst.mockResolvedValue(comment());
    prisma.screenplayComment.update.mockResolvedValue(comment({ deletedAt: createdAt }));
    const permissions = allowingPermissions();

    await expect(
      serviceWith(prisma, permissions).deleteComment(userId, screenplayId, 'comment-id'),
    ).resolves.toMatchObject({ body: null, deletedAt: createdAt.toISOString() });
    expect(permissions.assert).toHaveBeenCalledTimes(1);
    expect(prisma.screenplayComment.update).toHaveBeenCalledWith({
      where: { id: 'comment-id' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('requires settings permission to delete another author’s comment', async () => {
    const prisma = prismaStub();
    prisma.screenplayComment.findFirst.mockResolvedValue(comment({ authorUserId: otherUserId }));
    prisma.screenplayComment.update.mockResolvedValue(
      comment({ authorUserId: otherUserId, deletedAt: createdAt }),
    );
    const permissions = allowingPermissions();

    await serviceWith(prisma, permissions).deleteComment(userId, screenplayId, 'comment-id');
    expect(permissions.assert).toHaveBeenNthCalledWith(
      2,
      userId,
      screenplayId,
      'manage_screenplay_settings',
    );
  });

  it('hides deleted and cross-screenplay comments', async () => {
    const prisma = prismaStub();
    prisma.screenplayComment.findFirst.mockResolvedValue(null);
    await expect(
      serviceWith(prisma).updateComment(userId, screenplayId, 'missing', 'Nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.screenplayComment.findFirst).toHaveBeenCalledWith({
      where: { id: 'missing', deletedAt: null, thread: { screenplayId } },
    });
  });
});

describe('ScreenplayCommentsService resolution', () => {
  it('lets the thread author resolve and reopen using read access only', async () => {
    const prisma = prismaStub();
    prisma.screenplayCommentThread.findFirst.mockResolvedValue(thread());
    prisma.screenplayCommentThread.update
      .mockResolvedValueOnce(
        thread({
          status: 'RESOLVED',
          resolvedAt: createdAt,
          resolvedById: userId,
        }),
      )
      .mockResolvedValueOnce(thread());
    const permissions = allowingPermissions();
    const service = serviceWith(prisma, permissions);

    await expect(
      service.setResolved(userId, screenplayId, 'thread-id', true),
    ).resolves.toMatchObject({ status: 'RESOLVED', resolvedById: userId });
    await service.setResolved(userId, screenplayId, 'thread-id', false);
    expect(permissions.assert).toHaveBeenCalledTimes(2);
    expect(prisma.screenplayCommentThread.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { status: 'OPEN', resolvedAt: null, resolvedById: null },
      }),
    );
  });

  it('requires edit permission to resolve another member’s thread', async () => {
    const prisma = prismaStub();
    prisma.screenplayCommentThread.findFirst.mockResolvedValue(
      thread({ authorUserId: otherUserId }),
    );
    prisma.screenplayCommentThread.update.mockResolvedValue(
      thread({
        authorUserId: otherUserId,
        status: 'RESOLVED',
        resolvedAt: createdAt,
        resolvedById: userId,
      }),
    );
    const permissions = allowingPermissions();

    await serviceWith(prisma, permissions).setResolved(userId, screenplayId, 'thread-id', true);
    expect(permissions.assert).toHaveBeenNthCalledWith(2, userId, screenplayId, 'edit_screenplay');
  });
});
