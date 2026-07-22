import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CollaborationService } from './collaboration.service';

describe('CollaborationService activity privacy', () => {
  it('removes historical invitee emails from broadly readable activity metadata', async () => {
    const prisma = {
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'event-id',
            projectId: 'project-id',
            actorId: 'actor-id',
            action: 'INVITED',
            resourceType: 'invitation',
            resourceId: 'invitation-id',
            metadata: { email: 'invitee@example.test', roleId: 'role-id' },
            createdAt: new Date('2026-07-22T00:00:00.000Z'),
            actor: { id: 'actor-id', displayName: 'Actor' },
          },
        ]),
      },
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new CollaborationService(prisma as never, permissions as never);

    const events = await service.activity('viewer-id', 'project-id');

    expect(events[0]?.metadata).toEqual({ roleId: 'role-id' });
    expect(permissions.assert).toHaveBeenCalledWith('viewer-id', 'project-id', 'read_project');
  });

  it.each([
    ['comment', null],
    ['invitation', null],
    ['invitation', ['one', { email: 'preserved in arrays' }]],
    ['invitation', 'plain metadata'],
  ])('preserves non-object metadata for %s resources', async (resourceType, metadata) => {
    const prisma = {
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([{ id: 'event', resourceType, metadata }]),
      },
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new CollaborationService(prisma as never, permissions as never);

    const events = await service.activity('viewer', 'project', 'cursor');

    expect(events[0]?.metadata).toEqual(metadata);
    expect(prisma.activityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'cursor' }, skip: 1 }),
    );
  });
});

describe('CollaborationService comments', () => {
  function serviceWith(prisma: object) {
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    return {
      service: new CollaborationService(prisma as never, permissions as never),
      permissions,
    };
  }

  it('lists active comments oldest first after checking read access', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'comment' }]);
    const { service, permissions } = serviceWith({ comment: { findMany } });

    await expect(service.listComments('user', 'project', 'item')).resolves.toEqual([
      { id: 'comment' },
    ]);
    expect(permissions.assert).toHaveBeenCalledWith('user', 'project', 'read_project');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project', itemId: 'item', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('rejects a comment for a missing or trashed item before opening a transaction', async () => {
    const prisma = {
      breakdownItem: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    const { service } = serviceWith(prisma);

    await expect(service.comment('user', 'project', 'missing', 'Body')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates a comment, activity event, and project revision atomically', async () => {
    const created = { id: 'comment', body: 'Body' };
    const tx = {
      comment: { create: vi.fn().mockResolvedValue(created) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
      project: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      breakdownItem: { findFirst: vi.fn().mockResolvedValue({ id: 'item' }) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = serviceWith(prisma);

    await expect(service.comment('user', 'project', 'item', 'Body')).resolves.toBe(created);
    expect(tx.activityEvent.create).toHaveBeenCalledWith({
      data: {
        projectId: 'project',
        actorId: 'user',
        action: 'COMMENTED',
        resourceType: 'comment',
        resourceId: 'comment',
      },
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'project' },
      data: { revision: { increment: 1 } },
    });
  });

  it('rejects edits when the comment is absent or belongs to another author', async () => {
    const prisma = { comment: { findFirst: vi.fn() } };
    const { service } = serviceWith(prisma);
    prisma.comment.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateComment('user', 'project', 'comment', 'Body', 1),
    ).rejects.toBeInstanceOf(NotFoundException);
    prisma.comment.findFirst.mockResolvedValueOnce({ id: 'comment', authorId: 'other' });
    await expect(
      service.updateComment('user', 'project', 'comment', 'Body', 1),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('detects a stale edit and returns the updated comment on success', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'comment', authorId: 'user' });
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: 'comment', version: 2 });
    const { service } = serviceWith({ comment: { findFirst, updateMany, findUniqueOrThrow } });

    await expect(
      service.updateComment('user', 'project', 'comment', 'Body', 1),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateComment('user', 'project', 'comment', 'Body', 1)).resolves.toEqual({
      id: 'comment',
      version: 2,
    });
  });
});
