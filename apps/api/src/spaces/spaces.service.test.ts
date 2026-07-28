import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from './space-constants';
import { SpacesService } from './spaces.service';

const actor = {
  id: 'membership',
  roleId: 'owner-role',
  space: { id: 'space', deletedAt: null },
  role: {
    permissions: [
      { permission: 'read_space' },
      { permission: 'manage_space_settings' },
      { permission: 'invite_members' },
      { permission: 'manage_member_roles' },
      { permission: 'manage_roles' },
      { permission: 'delete_space' },
    ],
  },
};

function serviceWith(prisma: object, permissionResult: object = actor) {
  const permissions = {
    assert: vi.fn().mockResolvedValue(permissionResult),
    assertSession: vi.fn(),
  };
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new SpacesService(prisma as never, permissions as never, db as never),
    permissions,
    db,
  };
}

function transactionWith(tx: object, extra: object = {}) {
  return {
    ...extra,
    $transaction: vi.fn((callback: (transaction: object) => unknown) => callback(tx)),
  };
}

describe('SpacesService visibility and lifecycle', () => {
  it('shows a zero-member Default Space only through the caller resource slice', async () => {
    const mappings = vi
      .fn()
      .mockImplementation(({ where }: { where: { resourceType: string } }) => {
        return [{ spaceId: DEFAULT_SPACE_ID, resourceId: `${where.resourceType}-resource` }];
      });
    const prisma = {
      spaceMembership: { findMany: vi.fn().mockResolvedValue([]) },
      project: { findMany: vi.fn().mockResolvedValue([{ id: 'breakdown-resource' }]) },
      screenplayMembership: {
        findMany: vi.fn().mockResolvedValue([{ screenplayId: 'screenplay-resource' }]),
      },
      screenplay: { findMany: vi.fn().mockResolvedValue([{ id: 'screenplay-resource' }]) },
      spaceResource: { findMany: mappings },
      space: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: DEFAULT_SPACE_ID, name: 'Default', isDefault: true }]),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(service.list('user')).resolves.toEqual([
      {
        id: DEFAULT_SPACE_ID,
        name: 'Default',
        isDefault: true,
        currentMembership: null,
        resourceCounts: { breakdown: 1, screenplay: 1 },
      },
    ]);
    const membershipQuery = prisma.spaceMembership.findMany.mock.calls[0]?.[0] as unknown as {
      where: { userId: string };
    };
    const projectQuery = prisma.project.findMany.mock.calls[0]?.[0] as unknown as {
      where: { memberships: unknown };
    };
    expect(membershipQuery.where.userId).toBe('user');
    expect(projectQuery.where.memberships).toBeTruthy();
  });

  it('creates default roles and exactly one owner membership for a new Space', async () => {
    let roleIndex = 0;
    const tx = {
      space: { create: vi.fn().mockResolvedValue({ id: 'space', name: 'New' }) },
      spaceRole: { create: vi.fn().mockImplementation(() => ({ id: `role-${roleIndex++}` })) },
      spaceMembership: { create: vi.fn().mockResolvedValue({ id: 'membership' }) },
    };
    const { service, permissions } = serviceWith(transactionWith(tx));

    await expect(service.create('creator', { name: 'New' })).resolves.toEqual({
      id: 'space',
      name: 'New',
    });
    expect(permissions.assertSession).toHaveBeenCalledOnce();
    expect(tx.spaceRole.create).toHaveBeenCalledTimes(4);
    expect(tx.spaceMembership.create).toHaveBeenCalledWith({
      data: { spaceId: 'space', userId: 'creator', roleId: 'role-0' },
    });
  });

  it.each([
    [{ id: DEFAULT_SPACE_ID, isDefault: true, _count: { resources: 0 } }, 'Default'],
    [{ id: 'space', isDefault: false, _count: { resources: 1 } }, 'Move all resources'],
  ])('refuses protected deletion %#', async (space, message) => {
    const { service } = serviceWith({ space: { findFirst: vi.fn().mockResolvedValue(space) } });

    await expect(service.remove('user', 'space')).rejects.toThrow(message);
  });

  it('soft-deletes an empty non-default Space', async () => {
    const update = vi.fn().mockResolvedValue({});
    const { service, permissions } = serviceWith({
      space: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'space', isDefault: false, _count: { resources: 0 } }),
        update,
      },
    });

    await expect(service.remove('user', 'space')).resolves.toEqual({ id: 'space' });
    expect(permissions.assert).toHaveBeenCalledWith('user', 'space', 'delete_space');
    const updateInput = update.mock.calls[0]?.[0] as unknown as { data: { deletedAt: Date } };
    expect(updateInput.data.deletedAt).toBeInstanceOf(Date);
  });

  it('returns 404 for a missing Space after the permission choke point', async () => {
    const { service } = serviceWith({ space: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(service.remove('user', 'space')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SpacesService sharing graph', () => {
  it('creates a grantable custom role with its resource tier', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'role', resourceTier: 'contributor' });
    const { service } = serviceWith({
      spaceRole: { findFirst: vi.fn().mockResolvedValue({ position: 'V' }), create },
    });

    await expect(
      service.createRole('user', 'space', {
        name: 'Contributor',
        permissions: ['read_space'],
        resourceTier: 'contributor',
      }),
    ).resolves.toMatchObject({ id: 'role' });
    const createInput = create.mock.calls[0]?.[0] as unknown as {
      data: { resourceTier: string };
    };
    expect(createInput.data.resourceTier).toBe('contributor');
  });

  it('rejects a custom role that grants a permission the actor lacks', async () => {
    const restrictedActor = { ...actor, role: { permissions: [{ permission: 'read_space' }] } };
    const { service } = serviceWith({ spaceRole: { findFirst: vi.fn() } }, restrictedActor);

    await expect(
      service.createRole('user', 'space', {
        name: 'Unsafe',
        permissions: ['delete_space'],
        resourceTier: 'manager',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('adds a member only with a grantable non-owner role', async () => {
    const tx = {
      spaceRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer',
          isOwner: false,
          permissions: [{ permission: 'read_space' }],
        }),
      },
      spaceMembership: { create: vi.fn().mockResolvedValue({ id: 'new-membership' }) },
    };
    const { service } = serviceWith(
      transactionWith(tx, {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
        spaceMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      }),
    );

    await expect(service.addMembership('user', 'space', 'member', 'viewer')).resolves.toEqual({
      id: 'new-membership',
    });
  });

  it('protects owner and current-user memberships from removal', async () => {
    const owner = serviceWith({
      spaceMembership: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'other', role: { isOwner: true } }),
      },
    }).service;
    const self = serviceWith({
      spaceMembership: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'user', role: { isOwner: false } }),
      },
    }).service;

    await expect(owner.removeMembership('user', 'space', 'membership', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(self.removeMembership('user', 'space', 'membership', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
