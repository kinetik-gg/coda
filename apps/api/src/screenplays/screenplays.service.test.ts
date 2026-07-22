import { ConflictException, NotFoundException } from '@nestjs/common';
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

describe('ScreenplaysService', () => {
  it('lists only screenplays owned by the current user without loading source text', async () => {
    const findMany = vi.fn().mockResolvedValue([screenplay()]);
    const service = new ScreenplaysService({ screenplay: { findMany } } as never);

    await service.list('owner-id');

    expect(findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'owner-id' },
      orderBy: { updatedAt: 'desc' },
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
    const service = new ScreenplaysService({ screenplay: { create } } as never);

    await service.create('owner-id', { title: 'Pilot' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ownerUserId: 'owner-id',
          title: 'Pilot',
          filename: 'pilot.fountain',
          sourceText: '',
          paperSize: 'letter',
        },
      }),
    );
  });

  it('imports Fountain losslessly and derives its title', async () => {
    const create = vi.fn().mockResolvedValue(screenplay());
    const service = new ScreenplaysService({ screenplay: { create } } as never);
    const sourceText = 'Title: Imported Pilot\r\n\r\nINT. ROOM - DAY\r\n';

    await service.import('owner-id', {
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
          paperSize: 'letter',
        },
      }),
    );
  });

  it('does not reveal a screenplay owned by another user', async () => {
    const service = new ScreenplaysService({
      screenplay: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.get('other-user', 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates against the expected version and increments it atomically', async () => {
    const update = vi.fn().mockResolvedValue(screenplay({ title: 'Revised', version: 2 }));
    const service = new ScreenplaysService({ screenplay: { update } } as never);

    await expect(
      service.update('owner-id', 'screenplay-id', { title: 'Revised', version: 1 }),
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
    const service = new ScreenplaysService({ screenplay: { update } } as never);

    await service.update('owner-id', 'screenplay-id', { paperSize: 'a4', version: 1 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paperSize: 'a4', version: { increment: 1 } },
      }),
    );
  });

  it('reports a stale version as a conflict', async () => {
    const service = new ScreenplaysService({
      screenplay: {
        update: vi.fn().mockRejectedValue(missingRecordError()),
        findFirst: vi.fn().mockResolvedValue({ id: 'screenplay-id' }),
      },
    } as never);

    await expect(
      service.update('owner-id', 'screenplay-id', { sourceText: 'changed', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports inaccessible update targets as not found', async () => {
    const service = new ScreenplaysService({
      screenplay: {
        update: vi.fn().mockRejectedValue(missingRecordError()),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(
      service.update('other-user', 'screenplay-id', { sourceText: 'changed', version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not disguise database failures as version conflicts', async () => {
    const failure = new Error('database unavailable');
    const service = new ScreenplaysService({
      screenplay: { update: vi.fn().mockRejectedValue(failure) },
    } as never);

    await expect(
      service.update('owner-id', 'screenplay-id', { sourceText: 'changed', version: 1 }),
    ).rejects.toBe(failure);
  });
});
