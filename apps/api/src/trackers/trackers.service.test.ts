import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { allTrackerPermissions } from '@coda/contracts';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from '../spaces/space-constants';
import { TrackerActivityService } from './tracker-activity.service';
import { TrackerSpacesService } from './tracker-spaces.service';
import { TrackersService } from './trackers.service';

function tracker(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tracker-id',
    ownerUserId: 'owner-id',
    name: 'Continuity',
    description: null,
    version: 1,
    revision: 0,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

// A permissive permission double: every tracker endpoint is authorised through a direct owner
// membership. Tenant isolation and the tier matrix are covered by the permission service unit
// tests and the integration suite; these tests exercise versioning and placement mechanics.
function allowingPermissions() {
  return {
    assert: vi.fn().mockResolvedValue(directMembership()),
    directManagementMembership: vi.fn().mockResolvedValue(directMembership()),
  };
}

function directMembership() {
  return {
    id: 'membership-id',
    roleId: 'role-id',
    role: {
      archivedAt: null,
      isOwner: true,
      permissions: allTrackerPermissions.map((permission) => ({ permission })),
    },
  };
}

function missingRecordError() {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '6.19.3',
  });
}

function writeConflictError(code = 'P2034') {
  return new Prisma.PrismaClientKnownRequestError('Write conflict', {
    code,
    clientVersion: '6.19.3',
  });
}

// Mocks for the seeded role graph provisioned inside the create transaction.
function provisioningMocks() {
  return {
    trackerRole: { create: vi.fn().mockResolvedValue({ id: 'owner-role-id' }) },
    trackerMembership: { create: vi.fn().mockResolvedValue({ id: 'membership-id' }) },
    activityEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function spaceResourceMocks() {
  return {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'mapping' }),
  };
}

// The exact selection every read path uses; spelled out so call-shape assertions stay literal.
const expectedSelection = {
  id: true,
  ownerUserId: true,
  name: true,
  description: true,
  version: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
};

function service(prisma: object, permissions: object = allowingPermissions()) {
  const spaceCreation = { authorizeTarget: vi.fn().mockResolvedValue(DEFAULT_SPACE_ID) };
  return new TrackersService(
    prisma as never,
    permissions as never,
    new TrackerSpacesService(spaceCreation as never),
    // The real writer over the same doubles, so wired-emission assertions exercise the
    // exact rows the activity surface persists.
    new TrackerActivityService(prisma as never, permissions as never),
  );
}

function emittedEvents(client: { activityEvent: { create: ReturnType<typeof vi.fn> } }) {
  return client.activityEvent.create.mock.calls.map(
    (call) => (call[0] as { data: Record<string, unknown> }).data,
  );
}

describe('TrackersService', () => {
  it('lists only trackers the current user is a member of, excluding trashed rows', async () => {
    const findMany = vi.fn().mockResolvedValue([tracker()]);
    const membershipFindMany = vi.fn().mockResolvedValue([{ trackerId: 'tracker-id' }]);
    const target = service({
      tracker: { findMany },
      trackerMembership: { findMany: membershipFindMany },
    });

    await target.list('owner-id', {});

    expect(membershipFindMany).toHaveBeenCalledWith({
      where: { userId: 'owner-id' },
      select: { trackerId: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['tracker-id'] }, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: expectedSelection,
    });
  });

  it('narrows the list to a Space when spaceId is supplied', async () => {
    const listAccessibleIds = vi.fn().mockResolvedValue(['tracker-id']);
    const spaces = new TrackerSpacesService(
      { authorizeTarget: vi.fn() } as never,
      { listAccessibleResourceIds: listAccessibleIds } as never,
    );
    const findMany = vi.fn().mockResolvedValue([]);
    const target = new TrackersService(
      {
        trackerMembership: { findMany: vi.fn().mockResolvedValue([]) },
        tracker: { findMany },
      } as never,
      allowingPermissions() as never,
      spaces,
      new TrackerActivityService({} as never, allowingPermissions() as never),
    );

    await target.list('owner-id', { spaceId: DEFAULT_SPACE_ID });

    expect(listAccessibleIds).toHaveBeenCalledWith('owner-id', 'tracker', [], DEFAULT_SPACE_ID);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['tracker-id'] }, deletedAt: null } }),
    );
  });

  it('creates a tracker, provisions its role graph, and places it in the target Space atomically', async () => {
    const tx = {
      tracker: { create: vi.fn().mockResolvedValue(tracker()) },
      ...provisioningMocks(),
      spaceResource: spaceResourceMocks(),
    };
    const $transaction = vi.fn((callback: (value: typeof tx) => unknown) => callback(tx));
    const target = service({ $transaction });

    const created = await target.create('owner-id', { name: 'Continuity' });

    expect(created.id).toBe('tracker-id');
    expect(tx.tracker.create).toHaveBeenCalledWith({
      data: { ownerUserId: 'owner-id', name: 'Continuity', description: null },
      select: expectedSelection,
    });
    // Four seeded roles plus the owner-role membership.
    expect(tx.trackerRole.create).toHaveBeenCalledTimes(4);
    expect(tx.trackerMembership.create).toHaveBeenCalledWith({
      data: { trackerId: 'tracker-id', userId: 'owner-id', roleId: 'owner-role-id' },
    });
    // The Space placement ranks after any existing mapping in the same container.
    expect(tx.spaceResource.create).toHaveBeenCalledTimes(1);
    const placement = (tx.spaceResource.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      { data: Record<string, unknown> } | undefined;
    expect(placement?.data).toMatchObject({
      spaceId: DEFAULT_SPACE_ID,
      resourceType: 'tracker',
      resourceId: 'tracker-id',
    });
    expect(placement?.data.position).toEqual(expect.any(String));
    // Creation lands one tracker-scoped activity event in the same transaction: no projectId.
    expect(emittedEvents(tx)).toEqual([
      {
        trackerId: 'tracker-id',
        actorId: 'owner-id',
        action: 'CREATED',
        resourceType: 'tracker',
      },
    ]);
  });

  it('honours an explicit Space creation target after authorizing it', async () => {
    const spaceId = '00000000-0000-4000-8000-000000000009';
    const authorizeTarget = vi.fn().mockResolvedValue(spaceId);
    const tx = {
      tracker: { create: vi.fn().mockResolvedValue(tracker()) },
      ...provisioningMocks(),
      spaceResource: spaceResourceMocks(),
    };
    const target = new TrackersService(
      { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) } as never,
      allowingPermissions() as never,
      new TrackerSpacesService({ authorizeTarget } as never),
      new TrackerActivityService({} as never, allowingPermissions() as never),
    );

    await target.create('owner-id', { name: 'Continuity', spaceId });

    expect(authorizeTarget).toHaveBeenCalledWith('owner-id', spaceId);
    const placement = (tx.spaceResource.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      { data: Record<string, unknown> } | undefined;
    expect(placement?.data.spaceId).toBe(spaceId);
  });

  it.each(['P2034', 'P2002'] as const)(
    'retries serializable conflicts (%s) and surfaces one conflict after three attempts',
    async (code) => {
      const $transaction = vi
        .fn()
        .mockRejectedValueOnce(writeConflictError(code))
        .mockRejectedValueOnce(writeConflictError(code))
        .mockRejectedValue(writeConflictError(code));
      const target = service({ $transaction });

      await expect(target.create('owner-id', { name: 'Continuity' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect($transaction).toHaveBeenCalledTimes(3);
    },
  );

  it('recovers when only the first serializable attempt conflicts', async () => {
    const tx = {
      tracker: { create: vi.fn().mockResolvedValue(tracker()) },
      ...provisioningMocks(),
      spaceResource: spaceResourceMocks(),
    };
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(writeConflictError())
      .mockImplementation((callback: (value: typeof tx) => unknown) => callback(tx));
    const target = service({ $transaction });

    await expect(target.create('owner-id', { name: 'Continuity' })).resolves.toMatchObject({
      id: 'tracker-id',
    });
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('returns the tracker with the caller access permissions on get', async () => {
    const assert = vi.fn().mockResolvedValue({
      role: { permissions: [{ permission: 'read_tracker' }, { permission: 'comment_tracker' }] },
    });
    const findFirst = vi.fn().mockResolvedValue(tracker());
    const target = service({ tracker: { findFirst } }, { assert } as never);

    const result = await target.get('owner-id', 'tracker-id');

    expect(assert).toHaveBeenCalledWith('owner-id', 'tracker-id', 'read_tracker');
    expect(result.access.permissions).toEqual(['read_tracker', 'comment_tracker']);
  });

  it('404s a get for a tracker that vanished between authorization and read', async () => {
    const target = service({ tracker: { findFirst: vi.fn().mockResolvedValue(null) } });

    await expect(target.get('owner-id', 'tracker-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renames with optimistic version control and bumps revision', async () => {
    const tx = {
      tracker: { update: vi.fn().mockResolvedValue(tracker({ name: 'Renamed', version: 2 })) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await target.update('owner-id', 'tracker-id', { name: 'Renamed', version: 1 });

    expect(tx.tracker.update).toHaveBeenCalledWith({
      where: { id: 'tracker-id', version: 1, deletedAt: null },
      data: { name: 'Renamed', version: { increment: 1 }, revision: { increment: 1 } },
      select: expectedSelection,
    });
    expect(emittedEvents(tx)).toEqual([
      {
        trackerId: 'tracker-id',
        actorId: 'owner-id',
        action: 'UPDATED',
        resourceType: 'tracker',
      },
    ]);
  });

  it('keeps a description-only edit off the activity feed', async () => {
    const tx = {
      tracker: { update: vi.fn().mockResolvedValue(tracker({ version: 2 })) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await target.update('owner-id', 'tracker-id', { description: 'New', version: 1 });

    expect(tx.activityEvent.create).not.toHaveBeenCalled();
  });

  it('distinguishes a stale-version update (409) from a deleted tracker (404)', async () => {
    const tx = {
      tracker: { update: vi.fn().mockRejectedValue(missingRecordError()) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
      tracker: { findFirst: vi.fn().mockResolvedValue({ id: 'tracker-id' }) },
    };
    const target = service(prisma);

    await expect(
      target.update('owner-id', 'tracker-id', { name: 'Late', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.activityEvent.create).not.toHaveBeenCalled();

    const trashedPrisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
      tracker: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const trashed = service(trashedPrisma);
    await expect(
      trashed.update('owner-id', 'tracker-id', { name: 'Late', version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft-deletes with the deletion triple and requires manage_tracker_settings', async () => {
    const tx = {
      tracker: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const permissions = {
      directManagementMembership: vi.fn().mockResolvedValue({
        role: { archivedAt: null, permissions: [{ permission: 'manage_tracker_settings' }] },
      }),
    };
    const target = service(
      { $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)) },
      permissions,
    );

    const result = await target.remove('owner-id', 'tracker-id');

    expect(result.id).toBe('tracker-id');
    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(result.deletionBatchId).toEqual(expect.any(String));
    expect(tx.tracker.updateMany).toHaveBeenCalledWith({
      where: { id: 'tracker-id', deletedAt: null },
      data: {
        deletedAt: result.deletedAt,
        deletedById: 'owner-id',
        deletionBatchId: result.deletionBatchId,
        version: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    expect(emittedEvents(tx)).toEqual([
      {
        trackerId: 'tracker-id',
        actorId: 'owner-id',
        action: 'DELETED',
        resourceType: 'tracker',
      },
    ]);
  });

  it('403s a direct member without manage_tracker_settings on delete', async () => {
    const permissions = {
      directManagementMembership: vi.fn().mockResolvedValue({
        role: { archivedAt: null, permissions: [{ permission: 'read_tracker' }] },
      }),
    };
    const target = service({ $transaction: vi.fn() }, permissions as never);

    await expect(target.remove('owner-id', 'tracker-id')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s a delete racing a concurrent trash', async () => {
    const tx = { tracker: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const target = service({ $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)) });

    await expect(target.remove('owner-id', 'tracker-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});
