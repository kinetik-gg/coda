import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayLayoutsService } from './screenplay-layouts.service';

const screenplayId = '10000000-0000-4000-8000-000000000010';
const userId = '10000000-0000-4000-8000-000000000011';
const layout = { schemaVersion: 2, root: { kind: 'panel', id: 'a', panel: { id: 'b' } } };

interface PrismaStub {
  screenplayPanelLayout: {
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function prismaStub(overrides: Partial<PrismaStub['screenplayPanelLayout']> = {}): PrismaStub {
  return {
    screenplayPanelLayout: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
  };
}

// Access is delegated to ScreenplayPermissionService; the default double authorises read access.
function allowingPermissions() {
  return { assert: vi.fn().mockResolvedValue({ id: 'membership' }) };
}

function serviceWith(prisma: PrismaStub, permissions: object = allowingPermissions()) {
  return new ScreenplayLayoutsService(prisma as never, permissions as never);
}

describe('ScreenplayLayoutsService', () => {
  it('hides a screenplay the user is not a member of (404) before touching the layout row', async () => {
    const prisma = prismaStub();
    const permissions = {
      assert: vi.fn().mockRejectedValue(new NotFoundException('Screenplay not found')),
    };
    const service = serviceWith(prisma, permissions);
    await expect(service.get(userId, screenplayId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.save(userId, screenplayId, layout, 0)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.screenplayPanelLayout.findUnique).not.toHaveBeenCalled();
    expect(permissions.assert).toHaveBeenCalledWith(userId, screenplayId, 'read_screenplay');
  });

  it('keys the personal layout row on the requesting member, not the screenplay owner', async () => {
    const created = { screenplayId, userId, revision: 0, layout };
    const permissions = allowingPermissions();
    const prisma = prismaStub({
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    });
    const service = serviceWith(prisma, permissions);
    await service.save(userId, screenplayId, layout, 0);
    const createArg = prisma.screenplayPanelLayout.create.mock.calls[0]![0] as {
      data: { userId: string };
    };
    expect(createArg.data.userId).toBe(userId);
    expect(prisma.screenplayPanelLayout.findUnique).toHaveBeenCalledWith({
      where: { screenplayId_userId: { screenplayId, userId } },
      select: { revision: true },
    });
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
