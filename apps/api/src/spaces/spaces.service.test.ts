import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SpacePermissionService } from './space-permission.service';
import { SpacesService } from './spaces.service';

const DEFAULT_SPACE_ID = 'personal-default-space';

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

const defaultSpaceRow = {
  id: DEFAULT_SPACE_ID,
  name: 'Default',
  description: 'Your personal workspace.',
  ownerUserId: 'the-administrator',
  isDefault: true,
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

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
        findFirst: vi.fn().mockResolvedValue(defaultSpaceRow),
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

  // Pins the #266 audit finding and the deliberate response to it: a caller who reaches a
  // *non-Default* Space only via a directly-held project/screenplay (no Space membership at
  // all) sees a container label for that Space and nothing else. Before this change the full
  // row — `description`, `ownerUserId`, `version`, `createdAt`, `updatedAt` — was returned
  // regardless of membership; those fields are now withheld for exactly this caller.
  it('projects only a container label for a non-Default Space the caller does not belong to', async () => {
    const mappings = vi
      .fn()
      .mockImplementation(({ where }: { where: { resourceType: string } }) => {
        if (where.resourceType !== 'breakdown') return [];
        return [{ spaceId: 'other-space', resourceId: 'breakdown-resource' }];
      });
    const prisma = {
      spaceMembership: { findMany: vi.fn().mockResolvedValue([]) },
      project: { findMany: vi.fn().mockResolvedValue([{ id: 'breakdown-resource' }]) },
      screenplayMembership: { findMany: vi.fn().mockResolvedValue([]) },
      screenplay: { findMany: vi.fn().mockResolvedValue([]) },
      spaceResource: { findMany: mappings },
      space: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'other-space',
            name: 'Confidential Client Rebrand',
            description: 'Do not mention outside the core team',
            ownerUserId: 'someone-else',
            isDefault: false,
            version: 7,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-02'),
            deletedAt: null,
          },
        ]),
        findFirst: vi.fn().mockResolvedValue(defaultSpaceRow),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(service.list('user')).resolves.toEqual([
      {
        id: 'other-space',
        name: 'Confidential Client Rebrand',
        isDefault: false,
        currentMembership: null,
        resourceCounts: { breakdown: 1, screenplay: 0 },
      },
    ]);
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
  it('lists active users who are not already Space members', async () => {
    const users = [{ id: 'member', email: 'member@example.com', displayName: 'Member' }];
    const findMany = vi.fn().mockResolvedValue(users);
    const { service, permissions } = serviceWith({
      user: { findMany },
      spaceMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'existing-member' }]) },
    });

    await expect(service.availableUsers('user', 'space')).resolves.toEqual(users);
    expect(permissions.assert).toHaveBeenCalledWith('user', 'space', 'invite_members');
    const query = findMany.mock.calls[0]?.[0] as { where: { id: { notIn: string[] } } };
    expect(query.where.id.notIn).toEqual(['existing-member']);
  });

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

describe('SpacesService on a fresh account with a personal Default', () => {
  const administrator = 'the-administrator';
  const ownerRole = {
    id: 'default-owner-role',
    spaceId: DEFAULT_SPACE_ID,
    name: 'owner',
    isOwner: true,
    archivedAt: null,
    permissions: [
      { permission: 'read_space' },
      { permission: 'manage_space_settings' },
      { permission: 'invite_members' },
    ],
    _count: { memberships: 1 },
  };
  const ownerMembership = {
    id: 'default-owner-membership',
    spaceId: DEFAULT_SPACE_ID,
    userId: administrator,
    roleId: ownerRole.id,
    version: 1,
    createdAt: new Date('2026-01-01'),
    role: ownerRole,
    space: defaultSpaceRow,
  };

  function freshInstance() {
    const prisma = {
      spaceMembership: {
        findUnique: vi
          .fn()
          .mockImplementation(({ where }: { where: { spaceId_userId: { userId: string } } }) =>
            where.spaceId_userId.userId === administrator ? ownerMembership : null,
          ),
        findMany: vi
          .fn()
          .mockImplementation(({ where }: { where: { userId?: string } }) =>
            !where.userId || where.userId === administrator ? [ownerMembership] : [],
          ),
      },
      spaceRole: { findFirst: vi.fn().mockResolvedValue(ownerRole) },
      space: {
        findFirst: vi.fn().mockImplementation(({ include }: { include?: unknown }) =>
          include
            ? {
                ...defaultSpaceRow,
                roles: [ownerRole],
                memberships: [ownerMembership],
                invitations: [],
                _count: { resources: 0 },
              }
            : defaultSpaceRow,
        ),
        findMany: vi.fn().mockResolvedValue([defaultSpaceRow]),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      project: { findMany: vi.fn().mockResolvedValue([]) },
      screenplay: { findMany: vi.fn().mockResolvedValue([]) },
      screenplayMembership: { findMany: vi.fn().mockResolvedValue([]) },
      spaceResource: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const permissions = new SpacePermissionService(
      prisma as never,
      {
        credential: vi.fn().mockReturnValue(null),
      } as never,
    );
    return {
      prisma,
      service: new SpacesService(prisma as never, permissions, {
        acquireTransactionLock: vi.fn(),
      } as never),
    };
  }

  it('opens personal Default settings through its owner membership', async () => {
    const { prisma, service } = freshInstance();

    const management = await service.management(administrator, DEFAULT_SPACE_ID);

    expect(management.id).toBe(DEFAULT_SPACE_ID);
    expect(management.memberships).toHaveLength(1);
    expect(management.currentMembership).toEqual({
      id: ownerMembership.id,
      roleId: ownerRole.id,
      permissions: ['read_space', 'manage_space_settings', 'invite_members'],
    });
    expect(prisma.spaceMembership.findUnique).toHaveBeenCalled();
  });

  it('hides another user personal Default behind the ordinary 404 boundary', async () => {
    const { service } = freshInstance();

    await expect(service.management('someone-else', DEFAULT_SPACE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists the Default Space for the administrator before any resource exists', async () => {
    const { service } = freshInstance();

    const listed = await service.list(administrator);

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      ...defaultSpaceRow,
      currentMembership: { id: ownerMembership.id, roleId: ownerRole.id },
      resourceCounts: { breakdown: 0, screenplay: 0 },
    });
  });

  it('shows an ordinary user nothing at all, exactly as before', async () => {
    const { service } = freshInstance();

    await expect(service.list('someone-else')).resolves.toEqual([]);
  });

  it('still refuses to transfer ownership of the Default Space', async () => {
    const { service } = freshInstance();

    await expect(
      service.transferOwnership(administrator, DEFAULT_SPACE_ID, 'membership', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
