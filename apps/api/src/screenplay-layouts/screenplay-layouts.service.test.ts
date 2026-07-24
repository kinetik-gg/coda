import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayLayoutsService } from './screenplay-layouts.service';

const screenplayId = '10000000-0000-4000-8000-000000000010';
const userId = '10000000-0000-4000-8000-000000000011';
const layout = { schemaVersion: 2, root: { kind: 'panel', id: 'a', panel: { id: 'b' } } };

interface PrismaStub {
  screenplay: { findFirst: ReturnType<typeof vi.fn> };
  screenplayPanelLayout: {
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function prismaStub(overrides: Partial<PrismaStub['screenplayPanelLayout']> = {}): PrismaStub {
  return {
    screenplay: { findFirst: vi.fn().mockResolvedValue({ id: screenplayId }) },
    screenplayPanelLayout: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
  };
}

function serviceWith(prisma: PrismaStub) {
  return new ScreenplayLayoutsService(prisma as never);
}

describe('ScreenplayLayoutsService', () => {
  it('rejects access to a screenplay the user does not own', async () => {
    const prisma = prismaStub();
    prisma.screenplay.findFirst.mockResolvedValue(null);
    const service = serviceWith(prisma);
    await expect(service.get(userId, screenplayId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.save(userId, screenplayId, layout, 0)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.screenplayPanelLayout.findUnique).not.toHaveBeenCalled();
  });

  it('returns the stored layout, or null before the first save', async () => {
    const stored = { screenplayId, userId, revision: 3, layout };
    const withRow = serviceWith(prismaStub({ findUnique: vi.fn().mockResolvedValue(stored) }));
    await expect(withRow.get(userId, screenplayId)).resolves.toBe(stored);

    const empty = serviceWith(prismaStub({ findUnique: vi.fn().mockResolvedValue(null) }));
    await expect(empty.get(userId, screenplayId)).resolves.toBeNull();
  });

  it('creates the row on the first save at expectedRevision 0', async () => {
    const created = { screenplayId, userId, revision: 0, layout };
    const prisma = prismaStub({
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    });
    const service = serviceWith(prisma);
    await expect(service.save(userId, screenplayId, layout, 0)).resolves.toBe(created);
    const createArg = prisma.screenplayPanelLayout.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data).toMatchObject({ screenplayId, userId, schemaVersion: 2 });
    expect(prisma.screenplayPanelLayout.updateMany).not.toHaveBeenCalled();
  });

  it('conflicts when saving against a missing row with a non-zero expectedRevision', async () => {
    const prisma = prismaStub({ findUnique: vi.fn().mockResolvedValue(null) });
    const service = serviceWith(prisma);
    await expect(service.save(userId, screenplayId, layout, 4)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.screenplayPanelLayout.create).not.toHaveBeenCalled();
  });

  it('treats a unique-constraint race on create as a conflict', async () => {
    const prisma = prismaStub({
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    });
    const service = serviceWith(prisma);
    await expect(service.save(userId, screenplayId, layout, 0)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('increments the revision on an optimistic save that matches', async () => {
    const saved = { screenplayId, userId, revision: 5, layout };
    const prisma = prismaStub({
      findUnique: vi.fn().mockResolvedValue({ revision: 4 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(saved),
    });
    const service = serviceWith(prisma);
    await expect(service.save(userId, screenplayId, layout, 4)).resolves.toBe(saved);
    const updateArg = prisma.screenplayPanelLayout.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateArg.where).toEqual({ screenplayId, userId, revision: 4 });
    expect(updateArg.data).toMatchObject({ revision: { increment: 1 }, schemaVersion: 2 });
  });

  it('conflicts when the optimistic revision no longer matches', async () => {
    const prisma = prismaStub({
      findUnique: vi.fn().mockResolvedValue({ revision: 4 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });
    const service = serviceWith(prisma);
    await expect(service.save(userId, screenplayId, layout, 2)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.screenplayPanelLayout.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rejects a layout without a positive schemaVersion before touching the row', async () => {
    const prisma = prismaStub({ findUnique: vi.fn().mockResolvedValue(null) });
    const service = serviceWith(prisma);
    await expect(
      service.save(userId, screenplayId, { schemaVersion: 0 } as never, 0),
    ).rejects.toThrow();
    expect(prisma.screenplayPanelLayout.create).not.toHaveBeenCalled();
  });
});
