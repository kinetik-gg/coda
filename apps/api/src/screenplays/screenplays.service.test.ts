import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplaysService } from './screenplays.service';

function screenplay(overrides: Record<string, unknown> = {}) {
  return {
    id: 'screenplay-id',
    ownerUserId: 'owner-id',
    title: 'Pilot',
    filename: 'pilot.fountain',
    sourceText: 'Title: Pilot\n',
    paperSize: 'letter',
    version: 1,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    ...overrides,
  };
}

function missingRecordError() {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '6.19.3',
  });
}

function writeConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Write conflict', {
    code: 'P2034',
    clientVersion: '6.19.3',
  });
}

const limits = { maxDocumentsPerOwner: 250, maxSourceBytesPerOwner: 262_144_000 };

function service(prisma: object) {
  return new ScreenplaysService(prisma as never, limits);
}

describe('ScreenplaysService', () => {
  it('lists only screenplays owned by the current user without loading source text', async () => {
    const findMany = vi.fn().mockResolvedValue([screenplay()]);
    const target = service({ screenplay: { findMany } });

    await target.list('owner-id', { limit: 50 });

    expect(findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'owner-id' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: {
        id: true,
        ownerUserId: true,
        title: true,
        filename: true,
        paperSize: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('creates a Fountain-backed screenplay owned by the current user', async () => {
    const create = vi.fn().mockResolvedValue(screenplay());
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create,
      },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await target.create('owner-id', { title: 'Pilot' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ownerUserId: 'owner-id',
          title: 'Pilot',
          filename: 'pilot.fountain',
          sourceText: '',
          sourceByteLength: 0,
          paperSize: 'letter',
        },
      }),
    );
  });

  it('imports Fountain losslessly and derives its title', async () => {
    const create = vi.fn().mockResolvedValue(screenplay());
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create,
      },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });
    const sourceText = 'Title: Imported Pilot\r\n\r\nINT. ROOM - DAY\r\n';

    await target.import('owner-id', {
      filename: 'C:\\uploads\\draft.fountain',
      sourceText,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ownerUserId: 'owner-id',
          title: 'Imported Pilot',
          filename: 'draft.fountain',
          sourceText,
          sourceByteLength: Buffer.byteLength(sourceText, 'utf8'),
          paperSize: 'letter',
        },
      }),
    );
  });

  it('enforces document and aggregate UTF-8 byte quotas inside a serializable transaction', async () => {
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(250),
        aggregate: vi.fn(),
        create: vi.fn(),
      },
    };
    const transaction = vi.fn((callback: (value: typeof tx) => unknown) => callback(tx));
    const target = service({ $transaction: transaction });

    await expect(target.create('owner-id', { title: 'Over quota' })).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(tx.screenplay.create).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects aggregate source bytes before creating a screenplay', async () => {
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(1),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 262_144_000 } }),
        create: vi.fn(),
      },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await expect(
      target.create('owner-id', { title: 'Over bytes', sourceText: 'é' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(tx.screenplay.create).not.toHaveBeenCalled();
  });

  it('retries serializable quota checks after a concurrent write conflict', async () => {
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create: vi.fn().mockResolvedValue(screenplay()),
      },
    };
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(writeConflictError())
      .mockImplementation((callback: (value: typeof tx) => unknown) => callback(tx));
    const target = service({ $transaction: transaction });

    await expect(target.create('owner-id', { title: 'Concurrent' })).resolves.toEqual(
      expect.objectContaining({ id: 'screenplay-id' }),
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('uses UTF-8 bytes when updating aggregate source storage', async () => {
    const update = vi.fn().mockResolvedValue(screenplay({ version: 2 }));
    const tx = {
      screenplay: {
        findFirst: vi.fn().mockResolvedValue({ sourceByteLength: 1 }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 1 } }),
        update,
      },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await target.update('owner-id', 'screenplay-id', { sourceText: 'é', version: 1 });

    const updateInput = update.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined;
    expect(updateInput?.data).toMatchObject({ sourceText: 'é', sourceByteLength: 2 });
  });

  it('paginates with a stable updatedAt and id ordering', async () => {
    const rows = [
      screenplay({ id: '00000000-0000-4000-8000-000000000002' }),
      screenplay({ id: '00000000-0000-4000-8000-000000000001' }),
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const target = service({ screenplay: { findMany } });

    const first = await target.list('owner-id', { limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));

    findMany.mockResolvedValue([]);
    await target.list('owner-id', { limit: 1, cursor: first.nextCursor! });
    const listInput = findMany.mock.calls.at(-1)?.[0] as
      { where: { OR?: unknown[] }; orderBy: unknown[] } | undefined;
    expect(listInput?.where.OR).toEqual(expect.any(Array));
    expect(listInput?.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
  });

  it('does not reveal a screenplay owned by another user', async () => {
    const target = service({
      screenplay: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(target.get('other-user', 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates against the expected version and increments it atomically', async () => {
    const update = vi.fn().mockResolvedValue(screenplay({ title: 'Revised', version: 2 }));
    const target = service({ screenplay: { update } });

    await expect(
      target.update('owner-id', 'screenplay-id', { title: 'Revised', version: 1 }),
    ).resolves.toEqual(expect.objectContaining({ title: 'Revised', version: 2 }));
    expect(update).toHaveBeenCalledWith({
      where: { id: 'screenplay-id', ownerUserId: 'owner-id', version: 1 },
      data: { title: 'Revised', version: { increment: 1 } },
      select: {
        id: true,
        ownerUserId: true,
        title: true,
        filename: true,
        paperSize: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        sourceText: true,
      },
    });
  });

  it('persists A4 as part of an optimistic screenplay update', async () => {
    const update = vi.fn().mockResolvedValue(screenplay({ paperSize: 'a4', version: 2 }));
    const target = service({ screenplay: { update } });

    await target.update('owner-id', 'screenplay-id', { paperSize: 'a4', version: 1 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paperSize: 'a4', version: { increment: 1 } },
      }),
    );
  });

  it('reports a stale version as a conflict', async () => {
    const target = service({
      screenplay: {
        update: vi.fn().mockRejectedValue(missingRecordError()),
        findFirst: vi.fn().mockResolvedValue({ id: 'screenplay-id' }),
      },
    });

    await expect(
      target.update('owner-id', 'screenplay-id', { title: 'changed', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports inaccessible update targets as not found', async () => {
    const target = service({
      screenplay: {
        update: vi.fn().mockRejectedValue(missingRecordError()),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(
      target.update('other-user', 'screenplay-id', { title: 'changed', version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not disguise database failures as version conflicts', async () => {
    const failure = new Error('database unavailable');
    const target = service({
      screenplay: { update: vi.fn().mockRejectedValue(failure) },
    });

    await expect(
      target.update('owner-id', 'screenplay-id', { title: 'changed', version: 1 }),
    ).rejects.toBe(failure);
  });
});
