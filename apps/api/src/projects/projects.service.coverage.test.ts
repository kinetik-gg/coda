import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service';

const actor = {
  id: 'actor-membership',
  roleId: 'admin-role',
  project: { ownerUserId: 'owner' },
  role: {
    permissions: [
      { permission: 'read_project' },
      { permission: 'manage_items' },
      { permission: 'invite_members' },
      { permission: 'manage_roles' },
      { permission: 'manage_member_roles' },
    ],
  },
};

function serviceWith(prisma: object, permissionResult: object = actor) {
  const permissions = {
    assert: vi.fn().mockResolvedValue(permissionResult),
    membership: vi.fn().mockResolvedValue(permissionResult),
  };
  return { service: new ProjectsService(prisma as never, permissions as never), permissions };
}

function transactionWith(tx: object, extra: object = {}) {
  return {
    ...extra,
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
}

function activityModels() {
  return {
    project: { update: vi.fn().mockResolvedValue({}) },
    activityEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe('ProjectsService queries and creation', () => {
  it('lists projects with the current membership flattened', async () => {
    const projects = [
      { id: 'one', name: 'One', memberships: [{ id: 'membership' }] },
      { id: 'two', name: 'Two', memberships: [] },
    ];
    const findMany = vi.fn().mockResolvedValue(projects);
    const { service } = serviceWith({ project: { findMany } });
    await expect(service.list('user')).resolves.toEqual([
      { id: 'one', name: 'One', currentMembership: { id: 'membership' } },
      { id: 'two', name: 'Two', currentMembership: null },
    ]);
  });

  it('returns management data with the actor permission projection', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'project', name: 'Project' });
    const { service } = serviceWith({ project: { findFirst } });
    await expect(service.management('user', 'project')).resolves.toEqual({
      id: 'project',
      name: 'Project',
      currentMembership: {
        id: 'actor-membership',
        roleId: 'admin-role',
        permissions: actor.role.permissions.map(({ permission }) => permission),
      },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'project', deletedAt: null } }),
    );
  });

  it('rejects absent project detail and management records', async () => {
    const { service } = serviceWith({
      project: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    await expect(service.get('user', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.management('user', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a blank project with default roles, workspace layouts, and one item level', async () => {
    const roles = ['owner', 'admin', 'editor', 'viewer'].map((name, index) => ({
      id: `role-${index}`,
      name,
    }));
    const tx = {
      project: { create: vi.fn().mockResolvedValue({ id: 'project', name: 'New' }) },
      projectRole: { create: vi.fn().mockImplementation(() => Promise.resolve(roles.shift())) },
      projectMembership: { create: vi.fn().mockResolvedValue({ id: 'owner-membership' }) },
      projectWorkspaceDefault: { create: vi.fn().mockResolvedValue({}) },
      projectMembershipWorkspaceLayout: { create: vi.fn().mockResolvedValue({}) },
      entityType: { create: vi.fn().mockResolvedValue({ id: 'type' }) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(service.create('owner', { name: 'New', description: null })).resolves.toEqual({
      id: 'project',
      name: 'New',
    });
    expect(tx.projectRole.create).toHaveBeenCalledTimes(4);
    expect(tx.projectWorkspaceDefault.create).toHaveBeenCalledOnce();
    expect(tx.projectMembershipWorkspaceLayout.create).toHaveBeenCalledOnce();
    const entityTypeCreate = tx.entityType.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(entityTypeCreate.data).toMatchObject({
      singularName: 'Item',
      pluralName: 'Items',
      level: 1,
    });
  });

  it('applies a project template with nested levels, fields, and options', async () => {
    let nextType = 0;
    const tx = {
      project: { create: vi.fn().mockResolvedValue({ id: 'project', name: 'Film' }) },
      projectRole: {
        create: vi
          .fn()
          .mockImplementation((input: { data: { name: string } }) =>
            Promise.resolve({ id: `role-${input.data.name}` }),
          ),
      },
      projectMembership: { create: vi.fn().mockResolvedValue({ id: 'owner-membership' }) },
      projectWorkspaceDefault: { create: vi.fn().mockResolvedValue({}) },
      projectMembershipWorkspaceLayout: { create: vi.fn().mockResolvedValue({}) },
      entityType: {
        create: vi.fn().mockImplementation(() => Promise.resolve({ id: `type-${++nextType}` })),
      },
      fieldDefinition: { create: vi.fn().mockResolvedValue({}) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.createFromTemplate('owner', { name: 'Film', templateId: 'movie' }),
    ).resolves.toMatchObject({ id: 'project' });
    expect(tx.entityType.create.mock.calls.length).toBeGreaterThan(1);
    expect(tx.fieldDefinition.create.mock.calls.length).toBeGreaterThan(0);
    const fieldCreateCalls = tx.fieldDefinition.create.mock.calls as unknown as Array<
      [{ data: { options?: { create?: unknown[] } } }]
    >;
    expect(fieldCreateCalls.some(([call]) => Boolean(call.data.options?.create?.length))).toBe(
      true,
    );
  });

  it('updates supplied project metadata and detects a concurrent update', async () => {
    const project = {
      updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'project', version: 2 }),
    };
    const { service } = serviceWith({ project });
    await expect(
      service.update('user', 'project', { name: 'Renamed', description: null, version: 1 }),
    ).resolves.toMatchObject({ version: 2 });
    await expect(service.update('user', 'project', { version: 1 })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ProjectsService roles and memberships', () => {
  it('creates a grantable custom role after the existing roles', async () => {
    const tx = {
      projectRole: { create: vi.fn().mockResolvedValue({ id: 'role', name: 'Lead' }) },
      ...activityModels(),
    };
    const prisma = transactionWith(tx, {
      projectRole: { findFirst: vi.fn().mockResolvedValue({ position: 'V' }) },
    });
    const { service } = serviceWith(prisma);
    await expect(
      service.createRole('user', 'project', {
        name: 'Lead',
        description: 'Leads',
        permissions: ['read_project', 'manage_items'],
      }),
    ).resolves.toMatchObject({ id: 'role' });
    const roleCreate = tx.projectRole.create.mock.calls[0]?.[0] as unknown as {
      data: { permissions: { create: Array<{ permission: string }> } };
    };
    expect(roleCreate.data.permissions.create).toEqual([
      { permission: 'read_project' },
      { permission: 'manage_items' },
    ]);
  });

  it('updates role metadata and replaces its permissions atomically', async () => {
    const tx = {
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'role', isOwner: false }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'role', version: 2 }),
      },
      projectRolePermission: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      ...activityModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.updateRole('user', 'project', 'role', {
        name: 'Updated',
        description: null,
        permissions: ['read_project'],
        version: 1,
      }),
    ).resolves.toMatchObject({ version: 2 });
    expect(tx.projectRolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'role', permission: 'read_project' }],
    });
  });

  it.each([
    [null, 1, NotFoundException],
    [{ id: 'owner', isOwner: true }, 1, ConflictException],
    [{ id: 'role', isOwner: false }, 0, ConflictException],
  ])('defensively rejects an invalid role update %#', async (role, count, errorType) => {
    const tx = {
      projectRole: {
        findFirst: vi.fn().mockResolvedValue(role),
        updateMany: vi.fn().mockResolvedValue({ count }),
      },
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.updateRole('user', 'project', 'role', { version: 1 }),
    ).rejects.toBeInstanceOf(errorType);
  });

  it('archives an unused role and records the deletion activity', async () => {
    const tx = {
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'role',
          isOwner: false,
          _count: { memberships: 0, invitations: 0 },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'role', archivedAt: new Date() }),
      },
      ...activityModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(service.archiveRole('user', 'project', 'role', 1)).resolves.toMatchObject({
      id: 'role',
    });
    const archiveActivity = tx.activityEvent.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(archiveActivity.data).toMatchObject({ action: 'DELETED', resourceType: 'role' });
  });

  it.each([
    [null, 1, 'Role not found'],
    [
      { id: 'role', isOwner: false, _count: { memberships: 1, invitations: 0 } },
      1,
      'Reassign members',
    ],
    [
      { id: 'role', isOwner: false, _count: { memberships: 0, invitations: 0 } },
      0,
      'Role has changed',
    ],
  ])('rejects unsafe role archival %#', async (role, count, message) => {
    const tx = {
      projectRole: {
        findFirst: vi.fn().mockResolvedValue(role),
        updateMany: vi.fn().mockResolvedValue({ count }),
      },
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(service.archiveRole('user', 'project', 'role', 1)).rejects.toThrow(message);
  });

  it('updates a member role and returns the refreshed membership', async () => {
    const tx = {
      projectMembership: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'membership', roleId: 'viewer' }),
      },
      ...activityModels(),
    };
    const prisma = transactionWith(tx, {
      projectMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'membership', userId: 'member', role: { isOwner: false } }),
      },
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer',
          isOwner: false,
          permissions: [{ permission: 'read_project' }],
        }),
      },
    });
    const { service } = serviceWith(prisma);
    await expect(
      service.updateMembership('user', 'project', 'membership', 'viewer', 1),
    ).resolves.toMatchObject({ roleId: 'viewer' });
  });

  it('lists available active non-members', async () => {
    const users = [{ id: 'candidate', status: 'ACTIVE' }];
    const findMany = vi.fn().mockResolvedValue(users);
    const { service } = serviceWith({ user: { findMany } });
    await expect(service.availableUsers('user', 'project')).resolves.toBe(users);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          memberships: { none: { projectId: 'project' } },
        },
      }),
    );
  });

  it('adds a valid member and records the activity', async () => {
    const tx = {
      projectMembership: { create: vi.fn().mockResolvedValue({ id: 'membership' }) },
      ...activityModels(),
    };
    const prisma = transactionWith(tx, {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer',
          isOwner: false,
          permissions: [{ permission: 'read_project' }],
        }),
      },
      projectMembership: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const { service } = serviceWith(prisma);
    await expect(service.addMembership('user', 'project', 'member', 'viewer')).resolves.toEqual({
      id: 'membership',
    });
  });

  it.each([
    [null, { id: 'viewer', isOwner: false, permissions: [] }, null, NotFoundException],
    [
      { id: 'member' },
      { id: 'viewer', isOwner: false, permissions: [] },
      { id: 'existing' },
      ConflictException,
    ],
    [{ id: 'member' }, { id: 'owner', isOwner: true, permissions: [] }, null, ConflictException],
  ])('rejects invalid member additions %#', async (member, role, existing, errorType) => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue(member) },
      projectRole: { findFirst: vi.fn().mockResolvedValue(role) },
      projectMembership: { findUnique: vi.fn().mockResolvedValue(existing) },
    };
    const { service } = serviceWith(prisma);
    await expect(service.addMembership('user', 'project', 'member', 'role')).rejects.toBeInstanceOf(
      errorType,
    );
  });

  it('removes a non-owner membership with optimistic concurrency', async () => {
    const tx = {
      projectMembership: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      ...activityModels(),
    };
    const prisma = transactionWith(tx, {
      projectMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'member', userId: 'other', role: { isOwner: false } }),
      },
    });
    const { service } = serviceWith(prisma);
    await expect(service.removeMembership('user', 'project', 'member', 1)).resolves.toEqual({
      id: 'member',
    });
  });

  it.each([
    [null, 1, NotFoundException],
    [{ id: 'member', userId: 'other', role: { isOwner: true } }, 1, ConflictException],
    [{ id: 'member', userId: 'user', role: { isOwner: false } }, 1, ConflictException],
    [{ id: 'member', userId: 'other', role: { isOwner: false } }, 0, ConflictException],
  ])('rejects an unsafe membership removal %#', async (membership, count, errorType) => {
    const tx = { projectMembership: { deleteMany: vi.fn().mockResolvedValue({ count }) } };
    const prisma = transactionWith(tx, {
      projectMembership: { findFirst: vi.fn().mockResolvedValue(membership) },
    });
    const { service } = serviceWith(prisma);
    await expect(service.removeMembership('user', 'project', 'member', 1)).rejects.toBeInstanceOf(
      errorType,
    );
  });
});

describe('ProjectsService ownership transfer', () => {
  it('transfers ownership between active members and demotes the previous owner', async () => {
    const tx = {
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 'project' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'project', ownerUserId: 'target-user' }),
      },
      projectMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'target', userId: 'target-user', user: { status: 'ACTIVE' } }),
        update: vi.fn().mockResolvedValue({}),
      },
      projectRole: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce({ id: 'owner-role' })
          .mockResolvedValueOnce({ id: 'admin-role' }),
      },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const ownerActor = { ...actor, project: { ownerUserId: 'owner' } };
    const { service } = serviceWith(transactionWith(tx), ownerActor);
    await expect(service.transferOwnership('owner', 'project', 'target', 1)).resolves.toMatchObject(
      { ownerUserId: 'target-user' },
    );
    expect(tx.projectMembership.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'actor-membership' },
      data: { roleId: 'admin-role', version: { increment: 1 } },
    });
  });

  it('requires the current owner before starting a transaction', async () => {
    const { service } = serviceWith({}, actor);
    await expect(service.transferOwnership('not-owner', 'project', 'target', 1)).rejects.toThrow(
      'Only the current owner',
    );
  });

  it.each([
    [null, null, 1, 'Project or membership changed'],
    [
      { id: 'project' },
      { id: 'target', userId: 'target', user: { status: 'DISABLED' } },
      1,
      'active account',
    ],
    [
      { id: 'project' },
      { id: 'target', userId: 'owner', user: { status: 'ACTIVE' } },
      1,
      'another member',
    ],
    [
      { id: 'project' },
      { id: 'target', userId: 'target', user: { status: 'ACTIVE' } },
      0,
      'ownership has changed',
    ],
  ])('rejects an invalid ownership transfer %#', async (project, target, claimed, message) => {
    const tx = {
      project: {
        findFirst: vi.fn().mockResolvedValue(project),
        updateMany: vi.fn().mockResolvedValue({ count: claimed }),
      },
      projectMembership: { findFirst: vi.fn().mockResolvedValue(target) },
      projectRole: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce({ id: 'owner-role' })
          .mockResolvedValueOnce({ id: 'admin-role' }),
      },
    };
    const ownerActor = { ...actor, project: { ownerUserId: 'owner' } };
    const { service } = serviceWith(transactionWith(tx), ownerActor);
    await expect(service.transferOwnership('owner', 'project', 'target', 1)).rejects.toThrow(
      message,
    );
  });
});
