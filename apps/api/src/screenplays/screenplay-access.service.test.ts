import { ConflictException, NotFoundException } from '@nestjs/common';
import { allScreenplayPermissions } from '@coda/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayAccessService } from './screenplay-access.service';

function ownerMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'actor-membership',
    roleId: 'owner-role',
    role: {
      isOwner: true,
      permissions: allScreenplayPermissions.map((permission) => ({ permission })),
    },
    screenplay: { ownerUserId: 'owner' },
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

function service(prisma: object, perms: object = permissions()) {
  return new ScreenplayAccessService(prisma as never, perms as never, db as never);
}

describe('ScreenplayAccessService.management', () => {
  it('returns the role/membership/invitation graph with the caller membership', async () => {
    const perms = permissions();
    const target = service(
      {
        screenplay: { findUnique: vi.fn().mockResolvedValue({ id: 'screenplay-id' }) },
        screenplayRole: { findMany: vi.fn().mockResolvedValue([]) },
        screenplayMembership: { findMany: vi.fn().mockResolvedValue([]) },
        screenplayInvitation: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findMany: vi.fn().mockResolvedValue([]) },
      },
      perms,
    );

    const result = await target.management('user', 'screenplay-id');

    expect(perms.assert).toHaveBeenCalledWith(
      'user',
      'screenplay-id',
      'manage_screenplay_settings',
    );
    expect(result.currentMembership).toEqual({
      id: 'actor-membership',
      roleId: 'owner-role',
      permissions: allScreenplayPermissions,
    });
  });

  it('404s when the screenplay vanished after the permission check', async () => {
    const target = service({ screenplay: { findUnique: vi.fn().mockResolvedValue(null) } });

    await expect(target.management('user', 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ScreenplayAccessService.availableUsers', () => {
  it('lists active users who are not already members', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'candidate' }]);
    const target = service({
      screenplayMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'existing-member' }]),
      },
      user: { findMany },
    });

    await target.availableUsers('user', 'screenplay-id');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', id: { notIn: ['existing-member'] } },
      }),
    );
  });
});

describe('ScreenplayAccessService.invite', () => {
  it('delegates to the invitation issuer with the actor permissions', async () => {
    const tx = {
      screenplayRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer-role',
          permissions: [{ permission: 'read_screenplay' }],
        }),
      },
      screenplayInvitation: { create: vi.fn().mockResolvedValue({ id: 'invitation' }) },
    };
    const prisma = { $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    const result = await target.invite(
      'user',
      'screenplay-id',
      'invitee@example.test',
      'viewer-role',
    );

    expect(result.token).toEqual(expect.any(String));
    expect(tx.screenplayInvitation.create).toHaveBeenCalled();
  });
});

describe('ScreenplayAccessService.addMembership', () => {
  it('adds an active user to a non-owner role', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'membership' });
    const tx = {
      screenplayRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'editor-role',
          isOwner: false,
          permissions: [{ permission: 'read_screenplay' }],
        }),
      },
      screenplayMembership: { create },
    };
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'member' }),
        findUnique: vi.fn().mockResolvedValue({ id: 'member', email: 'm@example.test' }),
      },
      screenplayMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    const result = await target.addMembership('user', 'screenplay-id', 'member', 'editor-role');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { screenplayId: 'screenplay-id', userId: 'member', roleId: 'editor-role' },
      }),
    );
    // The member identity is hydrated from a separate lookup (no relation on the membership).
    expect(result.user).toEqual({ id: 'member', email: 'm@example.test' });
  });

  it('rejects an already-existing membership', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
      screenplayMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) },
    };
    const target = service(prisma);

    await expect(
      target.addMembership('user', 'screenplay-id', 'member', 'editor-role'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to assign the owner role directly', async () => {
    const tx = {
      screenplayRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'owner-role', isOwner: true, permissions: [] }),
      },
      screenplayMembership: { create: vi.fn() },
    };
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
      screenplayMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    await expect(
      target.addMembership('user', 'screenplay-id', 'member', 'owner-role'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ScreenplayAccessService.updateMembership', () => {
  it('changes a member role under optimistic concurrency', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      screenplayRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer-role',
          isOwner: false,
          permissions: [{ permission: 'read_screenplay' }],
        }),
      },
      screenplayMembership: {
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'membership' }),
      },
    };
    const prisma = {
      screenplayMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'membership', role: { isOwner: false } }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'member' }) },
      $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    await target.updateMembership('user', 'screenplay-id', 'membership', 'viewer-role', 1);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'membership', screenplayId: 'screenplay-id', version: 1 },
      data: { roleId: 'viewer-role', version: { increment: 1 } },
    });
  });

  it('refuses to re-role the owner membership', async () => {
    const prisma = {
      screenplayMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'owner-membership', role: { isOwner: true } }),
      },
    };
    const target = service(prisma);

    await expect(
      target.updateMembership('user', 'screenplay-id', 'owner-membership', 'viewer-role', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ScreenplayAccessService.removeMembership', () => {
  it('removes a non-owner membership under optimistic concurrency', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      screenplayMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'membership', userId: 'member', role: { isOwner: false } }),
        deleteMany,
      },
    };
    const target = service(prisma);

    await expect(
      target.removeMembership('user', 'screenplay-id', 'membership', 1),
    ).resolves.toEqual({ id: 'membership' });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'membership', screenplayId: 'screenplay-id', version: 1 },
    });
  });

  it('refuses to remove the owner', async () => {
    const prisma = {
      screenplayMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'owner', userId: 'owner', role: { isOwner: true } }),
      },
    };
    const target = service(prisma);

    await expect(
      target.removeMembership('user', 'screenplay-id', 'owner', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses self-removal', async () => {
    const prisma = {
      screenplayMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'self', userId: 'user', role: { isOwner: false } }),
      },
    };
    const target = service(prisma);

    await expect(
      target.removeMembership('user', 'screenplay-id', 'self', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ScreenplayAccessService.transferOwnership', () => {
  it('refuses when the caller is not the current owner', async () => {
    const perms = permissions(ownerMembership({ role: { isOwner: false, permissions: [] } }));
    const target = service({}, perms);

    await expect(
      target.transferOwnership('user', 'screenplay-id', 'target-membership', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('delegates to the ownership transfer when the caller owns the screenplay', async () => {
    const tx = {
      screenplay: {
        findFirst: vi.fn().mockResolvedValue({ id: 'screenplay-id', version: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'screenplay-id', version: 2 }),
      },
      screenplayMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'target-membership', userId: 'target' }),
        update: vi.fn().mockResolvedValue({}),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      screenplayRole: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce({ id: 'owner-role' })
          .mockResolvedValueOnce({ id: 'demotion-role' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'demotion-role' }),
      },
    };
    const prisma = { $transaction: vi.fn((cb: (v: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    await expect(
      target.transferOwnership('owner', 'screenplay-id', 'target-membership', 1),
    ).resolves.toEqual({ id: 'screenplay-id', version: 2 });
  });
});
