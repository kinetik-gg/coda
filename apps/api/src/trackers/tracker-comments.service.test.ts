import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TrackerCommentsService } from './tracker-comments.service';

const TRACKER = '10000000-0000-4000-8000-000000000001';
const RECORD = '30000000-0000-4000-8000-000000000003';
const COMMENT = '40000000-0000-4000-8000-000000000004';

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT,
    recordId: RECORD,
    authorId: 'author-id',
    body: 'Note',
    version: 1,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function commenterPermissions() {
  return {
    assert: vi.fn().mockResolvedValue({ role: { permissions: [] } }),
    assertCommenter: vi.fn().mockResolvedValue({ role: { permissions: [] } }),
  };
}

function service(prisma: object, permissions = commenterPermissions()): TrackerCommentsService {
  return new TrackerCommentsService(prisma as never, permissions as never);
}

describe('TrackerCommentsService', () => {
  it('lists live comments oldest first after checking read access', async () => {
    const findMany = vi.fn().mockResolvedValue([commentRow()]);
    const assert = vi.fn().mockResolvedValue({});
    const target = service({ trackerComment: { findMany } }, { assert, assertCommenter: vi.fn() });

    const result = await target.list('reader-id', TRACKER, RECORD, { limit: 100 });

    expect(assert).toHaveBeenCalledWith('reader-id', TRACKER, 'read_tracker');
    expect(result.nextCursor).toBeNull();
    const call = findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.where).toEqual({
      recordId: RECORD,
      deletedAt: null,
      record: { trackerId: TRACKER },
    });
    expect(call.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('pages by cursor and reports the next page token', async () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      commentRow({ id: `c-${index}`, createdAt: new Date(Date.UTC(2026, 7, index + 1)) }),
    );
    const findMany = vi.fn().mockResolvedValue(rows);
    const target = service({ trackerComment: { findMany } });

    const result = await target.list('reader-id', TRACKER, RECORD, {
      limit: 2,
      cursor: 'eyJpZCI6ImMtMCJ9',
    });
    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();
    expect(Buffer.from(result.nextCursor!, 'base64url').toString('utf8')).toBe(
      JSON.stringify({ id: 'c-1' }),
    );
    const call = findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.take).toBe(3);
    expect(call.cursor).toEqual({ id: 'c-0' });
    expect(call.skip).toBe(1);

    const empty = await target.list('reader-id', TRACKER, RECORD, { limit: 5 });
    expect(empty.nextCursor).toBeNull();
  });

  it('creates a comment only on a live record and rejects trashed or missing ones with 404', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: RECORD });
    const create = vi.fn().mockResolvedValue(commentRow());
    const $transaction = vi.fn();
    const target = service({
      trackerRecord: { findFirst },
      trackerComment: { create },
      $transaction,
    });

    await expect(
      target.create('author-id', TRACKER, RECORD, { body: 'Note' }),
    ).resolves.toMatchObject({
      id: COMMENT,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: RECORD, trackerId: TRACKER, deletedAt: null },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: { recordId: RECORD, authorId: 'author-id', body: 'Note' },
    });

    const gone = service({
      trackerRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      trackerComment: { create: vi.fn() },
      $transaction,
    });
    await expect(
      gone.create('author-id', TRACKER, RECORD, { body: 'Late' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('edits own comments, stamps editedAt, and disambiguates stale from missing', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(commentRow({ version: 2 }));
    const target = service({
      trackerComment: {
        findFirst: vi.fn().mockResolvedValue({ id: COMMENT, authorId: 'author-id' }),
        updateMany,
        findUniqueOrThrow,
      },
    });

    const updated = await target.update('author-id', TRACKER, RECORD, COMMENT, {
      body: 'Edited',
      version: 1,
    });
    expect(updated).toMatchObject({ id: COMMENT });
    const call = updateMany.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: COMMENT, version: 1 });
    expect(call.data.editedAt).toBeInstanceOf(Date);
    expect(call.data.version).toEqual({ increment: 1 });

    await expect(
      target.update('author-id', TRACKER, RECORD, COMMENT, { body: 'Again', version: 99 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('restricts edits to the author even for members holding manage permissions', async () => {
    const target = service({
      trackerComment: {
        findFirst: vi.fn().mockResolvedValue({ id: COMMENT, authorId: 'someone-else' }),
        updateMany: vi.fn(),
      },
    });
    await expect(
      target.update('author-id', TRACKER, RECORD, COMMENT, { body: 'Hijack', version: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('soft-deletes the author’s own comment and refuses everyone else', async () => {
    const update = vi.fn().mockResolvedValue(commentRow({ deletedAt: new Date() }));
    const target = service({
      trackerComment: {
        findFirst: vi.fn().mockResolvedValue({ id: COMMENT, authorId: 'author-id' }),
        update,
      },
    });
    const result = await target.remove('author-id', TRACKER, RECORD, COMMENT);
    expect(result.id).toBe(COMMENT);
    expect(result.deletedAt).toBeInstanceOf(Date);
    const call = update.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: COMMENT });
    expect(call.data.deletedAt).toBeInstanceOf(Date);

    const foreign = service({
      trackerComment: {
        findFirst: vi.fn().mockResolvedValue({ id: COMMENT, authorId: 'someone-else' }),
        update: vi.fn(),
      },
    });
    await expect(foreign.remove('author-id', TRACKER, RECORD, COMMENT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s updates and deletions for unknown or cross-record comment ids', async () => {
    const target = service({
      trackerComment: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    });
    await expect(
      target.update('author-id', TRACKER, RECORD, 'missing', { body: 'x', version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(target.remove('author-id', TRACKER, RECORD, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('checks the comment gate before touching any row', async () => {
    const prisma = {
      trackerRecord: { findFirst: vi.fn() },
      trackerComment: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    };
    const permissions = {
      assert: vi.fn(),
      assertCommenter: vi.fn().mockRejectedValue(new ForbiddenException('Missing permission')),
    };
    const target = service(prisma, permissions);

    await expect(target.create('u', TRACKER, RECORD, { body: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      target.update('u', TRACKER, RECORD, COMMENT, { body: 'x', version: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(target.remove('u', TRACKER, RECORD, COMMENT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(permissions.assertCommenter).toHaveBeenCalledTimes(3);
    expect(prisma.trackerRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.trackerComment.findFirst).not.toHaveBeenCalled();
  });
});
