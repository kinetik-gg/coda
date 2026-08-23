import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrackerDefaultWorkspaceLayout,
  ensureTrackerWorkspaceDefault,
} from './default-tracker-workspace-layout';
import { TrackerWorkspaceLayoutsService } from './tracker-workspace-layouts.service';

const trackerId = '20000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000002';

function membership(...granted: string[]) {
  return { role: { permissions: granted.map((permission) => ({ permission })) } };
}

function seededDefault(revision = 0) {
  return {
    trackerId,
    layout: createTrackerDefaultWorkspaceLayout(),
    schemaVersion: 1,
    revision,
    publishedById: null,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function transactionOf(tx: object) {
  return { $transaction: vi.fn((callback: (value: object) => unknown) => callback(tx)) };
}

function personalTable(overrides: object = {}) {
  return {
    upsert: vi.fn().mockResolvedValue({ trackerId, userId, revision: 0 }),
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ trackerId, userId, revision: 1 }),
    ...overrides,
  };
}

function defaultTable(row = seededDefault(), overrides: object = {}) {
  return {
    findUnique: vi.fn().mockResolvedValue(row),
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue(row),
    ...overrides,
  };
}

const conflictMetric = vi.fn();

function serviceWith(prisma: object, granted = ['read_tracker']) {
  const permissions = {
    assert: vi.fn((_userId: string, _trackerId: string, permission: string) =>
      granted.includes(permission)
        ? Promise.resolve(membership(...granted))
        : Promise.reject(new ForbiddenException(`Missing permission: ${permission}`)),
    ),
  };
  const metrics = { recordWorkspaceLayoutConflict: conflictMetric };
  return new TrackerWorkspaceLayoutsService(
    prisma as never,
    permissions as never,
    metrics as never,
  );
}

describe('default tracker workspace layout', () => {
  it('parses a grid-plus-inspector recipe at the current schema version', () => {
    const layout = createTrackerDefaultWorkspaceLayout();
    expect(layout.schemaVersion).toBe(1);
    expect(layout.root).toMatchObject({
      kind: 'split',
      first: { kind: 'panel', panel: { type: 'grid' } },
      second: { kind: 'panel', panel: { type: 'inspector', config: { section: 'details' } } },
    });
  });

  it('returns the existing default without writing', async () => {
    const row = seededDefault(4);
    const client = { trackerWorkspaceDefault: defaultTable(row) };

    await expect(ensureTrackerWorkspaceDefault(client as never, trackerId)).resolves.toBe(row);
    expect(client.trackerWorkspaceDefault.create).not.toHaveBeenCalled();
  });

  it('seeds the canonical row on first access and self-heals a seeding race by re-reading', async () => {
    const winner = seededDefault();
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )
      .mockResolvedValue(winner);
    const client = {
      trackerWorkspaceDefault: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
        findUniqueOrThrow: vi.fn().mockResolvedValue(winner),
      },
    };

    await expect(ensureTrackerWorkspaceDefault(client as never, trackerId)).resolves.toBe(winner);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(data.data).toMatchObject({ trackerId, schemaVersion: 1 });
    expect(data.data.userId).toBeUndefined();
    expect(client.trackerWorkspaceDefault.findUniqueOrThrow).toHaveBeenCalledOnce();
  });

  it('rethrows seeding failures that are not first-access races', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError('Connection lost', {
      code: 'P1001',
      clientVersion: 'test',
    });
    const client = {
      trackerWorkspaceDefault: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(failure),
        findUniqueOrThrow: vi.fn(),
      },
    };

    await expect(ensureTrackerWorkspaceDefault(client as never, trackerId)).rejects.toBe(failure);
    expect(client.trackerWorkspaceDefault.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('TrackerWorkspaceLayoutsService', () => {
  beforeEach(() => {
    conflictMetric.mockReset();
  });

  it('clones the default into an FK-free personal row on first read and reports publish rights', async () => {
    const publishedDefault = seededDefault();
    const personal = { trackerId, userId, revision: 0 };
    const personalTableFake = personalTable({
      upsert: vi.fn().mockResolvedValue(personal),
    });
    const tx = {
      trackerWorkspaceDefault: defaultTable(publishedDefault),
      trackerUserWorkspaceLayout: personalTableFake,
    };
    const prisma = transactionOf(tx);

    await expect(
      serviceWith(prisma, ['read_tracker', 'manage_tracker_settings']).get(userId, trackerId),
    ).resolves.toEqual({ personal, default: publishedDefault, canPublish: true });
    await expect(serviceWith(prisma).get(userId, trackerId)).resolves.toEqual({
      personal,
      default: publishedDefault,
      canPublish: false,
    });
    const upsert = personalTableFake.upsert.mock.calls[0]![0] as unknown as {
      where: unknown;
      update: unknown;
      create: Record<string, unknown>;
    };
    expect(upsert.where).toEqual({ trackerId_userId: { trackerId, userId } });
    expect(upsert.update).toEqual({});
    expect(upsert.create).toMatchObject({ trackerId, userId, schemaVersion: 1 });
    expect(JSON.stringify(upsert.create)).not.toContain('connect');
    expect(conflictMetric).not.toHaveBeenCalled();
  });

  it('diverges only the personal row when saving', async () => {
    const layout = createTrackerDefaultWorkspaceLayout();
    const saved = { trackerId, userId, revision: 3 };
    const personalTableFake = personalTable({
      findUniqueOrThrow: vi.fn().mockResolvedValue(saved),
    });
    const defaultTableFake = defaultTable(seededDefault(2));
    const tx = {
      trackerWorkspaceDefault: defaultTableFake,
      trackerUserWorkspaceLayout: personalTableFake,
    };

    await expect(serviceWith(transactionOf(tx)).save(userId, trackerId, layout, 2)).resolves.toBe(
      saved,
    );
    expect(personalTableFake.updateMany).toHaveBeenCalledWith({
      where: { trackerId, userId, revision: 2 },
      data: { layout, schemaVersion: 1, revision: { increment: 1 } },
    });
    expect(defaultTableFake.updateMany).not.toHaveBeenCalled();
    expect(defaultTableFake.create).not.toHaveBeenCalled();
  });

  it('records one conflict metric and retries nothing for a stale save', async () => {
    const personalTableFake = personalTable({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });
    const tx = {
      trackerWorkspaceDefault: defaultTable(),
      trackerUserWorkspaceLayout: personalTableFake,
    };

    await expect(
      serviceWith(transactionOf(tx)).save(
        userId,
        trackerId,
        createTrackerDefaultWorkspaceLayout(),
        9,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(personalTableFake.updateMany).toHaveBeenCalledOnce();
    expect(conflictMetric).toHaveBeenCalledWith('save');
    expect(conflictMetric).toHaveBeenCalledTimes(1);
    expect(personalTableFake.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('resets the personal row onto the latest default', async () => {
    const publishedDefault = seededDefault(4);
    const reset = { trackerId, userId, revision: 5 };
    const personalTableFake = personalTable({
      findUniqueOrThrow: vi.fn().mockResolvedValue(reset),
    });
    const tx = {
      trackerWorkspaceDefault: defaultTable(publishedDefault),
      trackerUserWorkspaceLayout: personalTableFake,
    };

    await expect(serviceWith(transactionOf(tx)).reset(userId, trackerId, 4)).resolves.toBe(reset);
    expect(personalTableFake.updateMany).toHaveBeenCalledWith({
      where: { trackerId, userId, revision: 4 },
      data: {
        layout: publishedDefault.layout,
        schemaVersion: 1,
        revision: { increment: 1 },
      },
    });
  });

  it('rejects a stale reset against the latest default', async () => {
    const tx = {
      trackerWorkspaceDefault: defaultTable(seededDefault(7)),
      trackerUserWorkspaceLayout: personalTable({
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      }),
    };

    await expect(serviceWith(transactionOf(tx)).reset(userId, trackerId, 3)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(conflictMetric).toHaveBeenCalledWith('reset');
  });

  it('refuses publication before any write when the settings grant is missing', async () => {
    const prisma = transactionOf({});
    const service = serviceWith(prisma, ['read_tracker']);

    await expect(service.publish(userId, trackerId, 1, 0)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('publishes the personal layout and bumps the default and tracker revisions together', async () => {
    const layout = createTrackerDefaultWorkspaceLayout();
    const publishedDefault = seededDefault(6);
    const tx = {
      trackerWorkspaceDefault: defaultTable(publishedDefault, {
        findUniqueOrThrow: vi.fn().mockResolvedValue(publishedDefault),
      }),
      trackerUserWorkspaceLayout: personalTable({
        findFirst: vi.fn().mockResolvedValue({ trackerId, userId, layout, revision: 3 }),
      }),
      tracker: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = serviceWith(transactionOf(tx), [
      'read_tracker',
      'manage_tracker_fields',
      'manage_tracker_settings',
    ]);

    await expect(service.publish(userId, trackerId, 3, 5)).resolves.toBe(publishedDefault);
    const defaultUpdate = tx.trackerWorkspaceDefault.updateMany.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(defaultUpdate.where).toEqual({ trackerId, revision: 5 });
    expect(defaultUpdate.data).toMatchObject({
      layout,
      schemaVersion: 1,
      publishedById: userId,
      revision: { increment: 1 },
    });
    expect(defaultUpdate.data.publishedAt).toBeInstanceOf(Date);
    expect(tx.tracker.updateMany).toHaveBeenCalledWith({
      where: { id: trackerId, deletedAt: null },
      data: { version: { increment: 1 }, revision: { increment: 1 } },
    });
    expect(conflictMetric).not.toHaveBeenCalled();
  });

  it.each([
    ['personal revision', null, { count: 1 }, ConflictException],
    [
      'default revision',
      { layout: createTrackerDefaultWorkspaceLayout() },
      { count: 0 },
      ConflictException,
    ],
  ])(
    'rejects publication when the %s has moved underneath the caller',
    async (_label, personal, defaultUpdate, exception) => {
      const tx = {
        trackerWorkspaceDefault: defaultTable(seededDefault(3), {
          updateMany: vi.fn().mockResolvedValue(defaultUpdate),
        }),
        trackerUserWorkspaceLayout: personalTable({
          findFirst: vi.fn().mockResolvedValue(personal),
        }),
        tracker: { updateMany: vi.fn() },
      };

      await expect(
        serviceWith(transactionOf(tx), ['read_tracker', 'manage_tracker_settings']).publish(
          userId,
          trackerId,
          2,
          3,
        ),
      ).rejects.toBeInstanceOf(exception);
      expect(tx.tracker.updateMany).not.toHaveBeenCalled();
      expect(conflictMetric).toHaveBeenCalledWith('publish');
    },
  );

  it('rejects publication of a trashed tracker instead of bumping its revision', async () => {
    const tx = {
      trackerWorkspaceDefault: defaultTable(),
      trackerUserWorkspaceLayout: personalTable({
        findFirst: vi.fn().mockResolvedValue({
          trackerId,
          userId,
          layout: createTrackerDefaultWorkspaceLayout(),
          revision: 1,
        }),
      }),
      tracker: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = serviceWith(transactionOf(tx), ['read_tracker', 'manage_tracker_settings']);

    await expect(service.publish(userId, trackerId, 1, 0)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.trackerWorkspaceDefault.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
