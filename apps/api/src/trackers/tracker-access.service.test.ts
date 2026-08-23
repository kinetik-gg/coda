import { ConflictException, NotFoundException } from '@nestjs/common';
import { allTrackerPermissions } from '@coda/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TrackerAccessService } from './tracker-access.service';

function ownerMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'actor-membership',
    roleId: 'owner-role',
    role: {
      isOwner: true,
      permissions: allTrackerPermissions.map((permission) => ({ permission })),
    },
    ...overrides,
  };
}

function permissions(membership: object = ownerMembership()) {
  return {
    assert: vi.fn().mockResolvedValue(membership),
    membership: vi.fn().mockResolvedValue(membership),
  };
}

const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };

function gatewayMock() {
  return { evictTrackerMember: vi.fn().mockResolvedValue(undefined) };
}

function activityMock() {
  return {
    memberAdded: vi.fn().mockResolvedValue(undefined),
    memberRemoved: vi.fn().mockResolvedValue(undefined),
    invitationCreated: vi.fn().mockResolvedValue(undefined),
  };
}

function service(
  prisma: object,
  perms: object = permissions(),
  gateway: object = gatewayMock(),
  activity: object = activityMock(),
) {
  return new TrackerAccessService(
    prisma as never,
    perms as never,
    db as never,
    gateway as never,
    activity as never,
  );
}

describe('TrackerAccessService permission matrix', () => {
  it('gates management behind manage_tracker_settings', async () => {
    const perms = permissions();
    const target = service(
      {
        tracker: { findFirst: vi.fn().mockResolvedValue({ id: 'tracker-id' }) },
        trackerRole: { findMany: vi.fn().mockResolvedValue([]) },
        trackerMembership: { findMany: vi.fn().mockResolvedValue([]) },
        trackerInvitation: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findMany: vi.fn().mockResolvedValue([]) },
      },
      perms,
    );

    await target.management('user', 'tracker-id');

    expect(perms.assert).toHaveBeenCalledWith('user', 'tracker-id', 'manage_tracker_settings');
  });

  it('gates invitation and member-addition routes behind invite_members', async () => {
    const perms = permissions();
    const grantableRole = {
      id: 'editor-role',
      isOwner: false,
      permissions: [{ permission: 'read_tracker' }],
    };
    const tx = {
      trackerRole: { findFirst: vi.fn().mockResolvedValue(grantableRole) },
      trackerMembership: { create: vi.fn().mockResolvedValue({ id: 'membership' }) },
      trackerInvitation: {
        create: vi
          .fn()
          .mockResolvedValue({ id: 'invitation-id', expiresAt: new Date(Date.now() + 1000) }),
      },
    };
    const target = service(
      {
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: 'member' }),
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue({ id: 'member', email: 'm@example.test' }),
        },
        trackerMembership: {
          findUnique: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
        },
        trackerInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
      },
      perms,
    );
    await target.availableUsers('user', 'tracker-id');
    await target.invite('user', 'tracker-id', 'invitee@example.test', 'editor-role');
    await target.addMembership('user', 'tracker-id', 'member', 'editor-role');
    await target.revokeInvitation('user', 'tracker-id', '00000000-0000-4000-8000-000000000001');

    for (const call of perms.assert.mock.calls) {
      expect(call[2]).toBe('invite_members');
    }
  });

  it('gates membership reassignment routes behind manage_member_roles', async () => {
    const perms = permissions();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const activeRole = {
      id: 'viewer-role',
      isOwner: false,
      permissions: [{ permission: 'read_tracker' }],
    };
    const tx = {
      trackerRole: { findFirst: vi.fn().mockResolvedValue(activeRole) },
      trackerMembership: {
        updateMany,
        deleteMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'membership', userId: 'member' }),
      },
    };
    const target = service(
      {
        trackerMembership: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'membership', userId: 'member', role: { isOwner: false } }),
          deleteMany,
        },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'member' }) },
        $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
      },
      perms,
    );
    await target.updateMembership('user', 'tracker-id', 'membership', 'viewer-role', 1);
    await target.removeMembership('user', 'tracker-id', 'membership', 1);

    const assertedPermissions = perms.assert.mock.calls.map(
      (call) => call[2] as 'manage_member_roles',
    );
    expect(assertedPermissions).toEqual(['manage_member_roles', 'manage_member_roles']);
  });

  it('gates custom role CRUD behind manage_roles', async () => {
    const perms = permissions();
    const create = vi.fn().mockResolvedValue({ id: 'role' });
    const tx = {
      trackerRole: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
    };
    const target = service(
      {
        trackerRole: { findFirst: vi.fn().mockResolvedValue(null), create },
        $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
      },
      perms,
    );
    await target.createRole('user', 'tracker-id', {
      name: 'reviewer',
      permissions: ['read_tracker'],
    });
    await target.archiveRole('user', 'tracker-id', 'role-id', 1).catch(() => undefined);

    const assertedPermissions = perms.assert.mock.calls.map((call) => call[2] as 'manage_roles');
    expect(assertedPermissions).toEqual(['manage_roles', 'manage_roles']);
  });
});

describe('TrackerAccessService.management', () => {
  it('returns the role/membership/invitation graph with the caller membership', async () => {
    const perms = permissions();
    const target = service(
      {
        tracker: { findFirst: vi.fn().mockResolvedValue({ id: 'tracker-id' }) },
        trackerRole: { findMany: vi.fn().mockResolvedValue([]) },
        trackerMembership: { findMany: vi.fn().mockResolvedValue([]) },
        trackerInvitation: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findMany: vi.fn().mockResolvedValue([]) },
      },
      perms,
    );

    const result = await target.management('user', 'tracker-id');

    expect(result.currentMembership).toEqual({
      id: 'actor-membership',
      roleId: 'owner-role',
      permissions: allTrackerPermissions,
    });
  });

  it('404s when the tracker vanished or is trashed after the permission check', async () => {
    const target = service({ tracker: { findFirst: vi.fn().mockResolvedValue(null) } });

    await expect(target.management('user', 'tracker-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TrackerAccessService.availableUsers', () => {
  it('lists active users who are not already members', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'candidate' }]);
    const target = service({
      trackerMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'existing' }]) },
      user: { findMany },
    });

    await target.availableUsers('user', 'tracker-id');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', id: { notIn: ['existing'] } },
      }),
    );
  });
});

describe('TrackerAccessService.addMembership', () => {
  it('adds an active user to a non-owner role the actor can grant', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'membership', userId: 'member' });
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'editor-role',
          isOwner: false,
          permissions: [{ permission: 'read_tracker' }],
        }),
      },
      trackerMembership: { create },
    };
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'member' }),
        findUnique: vi.fn().mockResolvedValue({ id: 'member', email: 'm@example.test' }),
      },
      trackerMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    const result = await target.addMembership('user', 'tracker-id', 'member', 'editor-role');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { trackerId: 'tracker-id', userId: 'member', roleId: 'editor-role' },
      }),
    );
    // The member identity is hydrated from a separate lookup (no relation on the membership).
    expect(result.user).toEqual({ id: 'member', email: 'm@example.test' });
  });

  it('rejects an already-existing membership', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
      trackerMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) },
    };
    const target = service(prisma);

    await expect(
      target.addMembership('user', 'tracker-id', 'member', 'editor-role'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to assign the owner role directly', async () => {
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'owner-role', isOwner: true, permissions: [] }),
      },
      trackerMembership: { create: vi.fn() },
    };
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
      trackerMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    await expect(
      target.addMembership('user', 'tracker-id', 'member', 'owner-role'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to grant permissions the actor does not hold', async () => {
    const perms = permissions(
      ownerMembership({
        role: {
          isOwner: false,
          permissions: [{ permission: 'read_tracker' }],
        },
      }),
    );
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'admin-role',
          isOwner: false,
          permissions: [{ permission: 'edit_tracker_records' }],
        }),
      },
      trackerMembership: { create: vi.fn() },
    };
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
      trackerMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma, perms);

    await expect(
      target.addMembership('user', 'tracker-id', 'member', 'admin-role'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.trackerMembership.create).not.toHaveBeenCalled();
  });
});

describe('TrackerAccessService.updateMembership', () => {
  it('changes a member role under optimistic concurrency and evicts the socket', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer-role',
          isOwner: false,
          permissions: [{ permission: 'read_tracker' }],
        }),
      },
      trackerMembership: {
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'membership', userId: 'member' }),
      },
    };
    const prisma = {
      trackerMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'membership', userId: 'member', role: { isOwner: false } }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'member' }) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const gateway = gatewayMock();
    const target = service(prisma, permissions(), gateway);

    await target.updateMembership('user', 'tracker-id', 'membership', 'viewer-role', 1);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'membership', trackerId: 'tracker-id', version: 1 },
      data: { roleId: 'viewer-role', version: { increment: 1 } },
    });
    expect(gateway.evictTrackerMember).toHaveBeenCalledWith('tracker-id', 'member');
  });

  it('reports a stale version as a conflict without evicting', async () => {
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer-role',
          isOwner: false,
          permissions: [],
        }),
      },
      trackerMembership: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
    };
    const prisma = {
      trackerMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'membership', userId: 'member', role: { isOwner: false } }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'member' }) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const gateway = gatewayMock();
    const target = service(prisma, permissions(), gateway);

    await expect(
      target.updateMembership('user', 'tracker-id', 'membership', 'viewer-role', 4),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(gateway.evictTrackerMember).not.toHaveBeenCalled();
  });

  it('refuses to re-role the owner membership', async () => {
    const prisma = {
      trackerMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'owner-membership', role: { isOwner: true } }),
      },
    };
    const target = service(prisma);

    await expect(
      target.updateMembership('user', 'tracker-id', 'owner-membership', 'viewer-role', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('TrackerAccessService.removeMembership', () => {
  it('removes a non-owner membership under optimistic concurrency and evicts the socket', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      trackerMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'membership', userId: 'member', role: { isOwner: false } }),
        deleteMany,
      },
    };
    const gateway = gatewayMock();
    const target = service(prisma, permissions(), gateway);

    await expect(target.removeMembership('user', 'tracker-id', 'membership', 1)).resolves.toEqual({
      id: 'membership',
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'membership', trackerId: 'tracker-id', version: 1 },
    });
    expect(gateway.evictTrackerMember).toHaveBeenCalledWith('tracker-id', 'member');
  });

  it('refuses to remove the owner', async () => {
    const prisma = {
      trackerMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'owner', userId: 'owner', role: { isOwner: true } }),
      },
    };
    const target = service(prisma);

    await expect(target.removeMembership('user', 'tracker-id', 'owner', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses self-removal', async () => {
    const prisma = {
      trackerMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'self', userId: 'user', role: { isOwner: false } }),
      },
    };
    const target = service(prisma);

    await expect(target.removeMembership('user', 'tracker-id', 'self', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('TrackerAccessService.custom roles', () => {
  it('refuses to create a role granting more than the actor holds', async () => {
    const perms = permissions(
      ownerMembership({
        role: { isOwner: false, permissions: [{ permission: 'read_tracker' }] },
      }),
    );
    const target = service({}, perms);

    await expect(
      target.createRole('user', 'tracker-id', {
        name: 'power',
        permissions: ['read_tracker', 'edit_tracker_records'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a role ranked after every existing one', async () => {
    const perms = permissions();
    const create = vi.fn().mockResolvedValue({ id: 'role' });
    const target = service(
      {
        trackerRole: {
          findFirst: vi.fn().mockResolvedValue({ position: '8' }),
          create,
        },
      },
      perms,
    );

    await target.createRole('user', 'tracker-id', {
      name: 'reviewer',
      description: null,
      permissions: ['read_tracker'],
    });

    const createdInput = create.mock.calls[0]?.[0] as {
      data: { trackerId: string; name: string; position: string };
    };
    expect(createdInput.data).toMatchObject({ trackerId: 'tracker-id', name: 'reviewer' });
    expect(createdInput.data.position.length).toBeGreaterThan(0);
  });

  it('refuses to change or archive the owner role', async () => {
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'owner-role', isOwner: true }),
        updateMany: vi.fn(),
      },
    };
    const prisma = { $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    await expect(
      target.updateRole('user', 'tracker-id', 'owner-role', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(target.archiveRole('user', 'tracker-id', 'owner-role', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('restates permissions under the subset rule and evicts every holder', async () => {
    const perms = permissions();
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'editor-role', isOwner: false }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'editor-role' }),
      },
      trackerRolePermission: { deleteMany, createMany },
    };
    const prisma = {
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
      trackerMembership: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ userId: 'holder-a' }, { userId: 'holder-b' }, { userId: 'actor' }]),
      },
    };
    const gateway = gatewayMock();
    const target = service(prisma, perms, gateway);

    await target.updateRole('user', 'tracker-id', 'editor-role', {
      version: 1,
      permissions: ['read_tracker'],
    });

    expect(createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'editor-role', permission: 'read_tracker' }],
    });
    expect(gateway.evictTrackerMember).toHaveBeenCalledTimes(3);
    expect(gateway.evictTrackerMember).toHaveBeenCalledWith('tracker-id', 'holder-a');
    expect(gateway.evictTrackerMember).toHaveBeenCalledWith('tracker-id', 'holder-b');
  });

  it('refuses an updated permission set exceeding the actor grants', async () => {
    const perms = permissions(
      ownerMembership({
        role: { isOwner: false, permissions: [{ permission: 'read_tracker' }] },
      }),
    );
    const target = service({}, perms);

    await expect(
      target.updateRole('user', 'tracker-id', 'editor-role', {
        version: 1,
        permissions: ['manage_tracker_fields'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses archiving while members or pending invitations reference the role', async () => {
    const tx = {
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'editor-role',
          isOwner: false,
          _count: { memberships: 2, invitations: 0 },
        }),
        updateMany: vi.fn(),
      },
    };
    const prisma = { $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    await expect(target.archiveRole('user', 'tracker-id', 'editor-role', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('TrackerAccessService.revokeInvitation', () => {
  it('revokes a pending invitation once and 404s afterwards', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const target = service({ trackerInvitation: { updateMany } });

    await expect(target.revokeInvitation('user', 'tracker-id', 'invitation')).resolves.toEqual({
      id: 'invitation',
    });
    await expect(
      target.revokeInvitation('user', 'tracker-id', 'invitation'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const revokeInput = updateMany.mock.calls.at(-1)?.[0] as {
      where: { id: string; trackerId: string; status: string; revokedAt: null };
      data: { status: string; revokedAt: unknown };
    };
    expect(revokeInput.where).toEqual({
      id: 'invitation',
      trackerId: 'tracker-id',
      status: 'PENDING',
      revokedAt: null,
    });
    expect(revokeInput.data.status).toBe('REVOKED');
    expect(revokeInput.data.revokedAt).toBeInstanceOf(Date);
  });
});

describe('TrackerAccessService.transferOwnership', () => {
  it('refuses when the caller is not the current owner', async () => {
    const perms = permissions(ownerMembership({ role: { isOwner: false, permissions: [] } }));
    const target = service({}, perms);

    await expect(
      target.transferOwnership('user', 'tracker-id', 'target-membership', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('delegates the ceremony and evicts both ends of the transfer', async () => {
    const tx = {
      tracker: {
        findFirst: vi.fn().mockResolvedValue({ id: 'tracker-id', version: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'tracker-id', version: 2 }),
      },
      trackerMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'target-membership', userId: 'target' }),
        update: vi.fn().mockResolvedValue({}),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      trackerRole: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce({ id: 'owner-role' })
          .mockResolvedValueOnce({ id: 'demotion-role' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'demotion-role' }),
      },
    };
    const prisma = {
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
      trackerMembership: { findFirst: vi.fn().mockResolvedValue({ userId: 'target' }) },
    };
    const gateway = gatewayMock();
    const target = service(prisma, permissions(), gateway);

    await expect(
      target.transferOwnership('owner', 'tracker-id', 'target-membership', 1),
    ).resolves.toEqual({ id: 'tracker-id', version: 2 });
    expect(gateway.evictTrackerMember).toHaveBeenCalledWith('tracker-id', 'owner');
    expect(gateway.evictTrackerMember).toHaveBeenCalledWith('tracker-id', 'target');
  });
});
