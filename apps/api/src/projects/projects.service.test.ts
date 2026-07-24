import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { projectTemplates } from './project-templates';
import { PostgresDatabaseCapabilities } from '../database/postgres-database-capabilities';
import { ProjectsService } from './projects.service';

type AssertGrantable = (
  actorPermissions: Array<{ permission: string }>,
  requestedPermissions: string[],
) => void;

function serviceWith(prisma: object, permissionResult: object) {
  const permissions = { assert: vi.fn().mockResolvedValue(permissionResult) };
  return new ProjectsService(
    prisma as never,
    permissions as never,
    new PostgresDatabaseCapabilities(prisma as never),
  );
}

const actor = {
  id: 'actor-membership',
  project: { ownerUserId: 'owner-user' },
  role: {
    permissions: [
      { permission: 'read_project' },
      { permission: 'manage_roles' },
      { permission: 'manage_member_roles' },
    ],
  },
};

describe('ProjectsService role administration', () => {
  it('offers active accounts and non-owner roles for staged project creation', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: 'member-user', displayName: 'Member', email: 'member@example.test' },
      ]);
    const service = serviceWith({ user: { findMany } }, actor);

    await expect(service.creationOptions('actor-user')).resolves.toEqual({
      users: [{ id: 'member-user', displayName: 'Member', email: 'member@example.test' }],
      roles: [{ name: 'admin' }, { name: 'editor' }, { name: 'viewer' }],
      templates: projectTemplates.map(({ id, name, description, levels }) => ({
        id,
        name,
        description,
        levels: levels.map(({ singularName, pluralName }) => ({ singularName, pluralName })),
      })),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { not: 'actor-user' }, status: 'ACTIVE' },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, displayName: true },
    });
  });

  it('selects non-sensitive member identity for general project detail', async () => {
    type GeneralProjectQuery = {
      include: {
        memberships: {
          include: { user: { select: Record<string, boolean> } };
        };
      };
    };
    const findUnique = vi.fn((query: GeneralProjectQuery) => {
      void query;
      return Promise.resolve({ id: 'project' });
    });
    const service = serviceWith({ project: { findUnique } }, actor);

    await service.get('actor-user', 'project');

    const selection = findUnique.mock.calls[0]![0].include.memberships.include.user.select;
    expect(selection).toEqual({ id: true, displayName: true });
    expect(selection).not.toHaveProperty('email');
  });

  it('uses an allowlisted projection for delegated project detail', async () => {
    type ExternalProjectQuery = {
      select: {
        roles?: unknown;
        memberships?: unknown;
        sourceDocuments: {
          select: { storageObject: { select: Record<string, boolean> } };
        };
      };
    };
    const findUnique = vi.fn((query: ExternalProjectQuery) => {
      void query;
      return Promise.resolve({ id: 'project' });
    });
    const service = serviceWith({ project: { findUnique } }, actor);

    await service.getExternal('actor-user', 'project');

    const query = findUnique.mock.calls[0]![0];
    expect(query.select).not.toHaveProperty('roles');
    expect(query.select).not.toHaveProperty('memberships');
    expect(query.select.sourceDocuments.select.storageObject.select).toEqual({
      id: true,
      projectId: true,
      kind: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      version: true,
    });
  });

  it('does not write an invitee email into broadly readable activity metadata', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'viewer-role',
          isOwner: false,
          permissions: [{ permission: 'read_project' }],
        }),
      },
      projectInvitation: {
        create: vi.fn().mockResolvedValue({
          id: 'invitation-id',
          expiresAt: new Date('2026-07-29T00:00:00.000Z'),
        }),
      },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, actor);

    await service.invite('actor-user', 'project', 'invitee@example.test', 'viewer-role');

    expect(tx.activityEvent.create).toHaveBeenCalledWith({
      data: {
        projectId: 'project',
        actorId: 'actor-user',
        action: 'INVITED',
        resourceType: 'invitation',
        resourceId: 'invitation-id',
        metadata: { roleId: 'viewer-role' },
      },
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectRole.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(tx.projectRole.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectInvitation.create.mock.invocationCallOrder[0]!,
    );
  });

  it('does not issue an invitation when the role is archived while waiting for its lock', async () => {
    const create = vi.fn();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: { findFirst: vi.fn().mockResolvedValue(null) },
      projectInvitation: { create },
    };
    const prisma = {
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, actor);

    await expect(
      service.invite('actor-user', 'project', 'invitee@example.test', 'archived-role'),
    ).rejects.toThrow('Role not found');
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it('prevents granting a permission the actor does not possess', () => {
    const service = serviceWith({}, actor);
    const assertGrantable = (
      service as unknown as { assertGrantable: AssertGrantable }
    ).assertGrantable.bind(service);

    expect(() =>
      assertGrantable(actor.role.permissions, ['read_project', 'delete_project']),
    ).toThrow(ConflictException);
  });

  it('does not allow the owner role to be assigned through membership administration', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'owner-role',
          isOwner: true,
          permissions: actor.role.permissions,
        }),
      },
    };
    const prisma = {
      projectMembership: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'member',
          userId: 'member-user',
          role: { isOwner: false },
        }),
      },
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = serviceWith(prisma, actor);

    await expect(
      service.updateMembership('actor-user', 'project', 'member', 'owner-role', 1),
    ).rejects.toThrow('owner role can only be assigned by transfer');
  });

  it('does not allow the owner role to be archived', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'owner-role',
          isOwner: true,
          _count: { memberships: 1, invitations: 0, instanceInvitations: 0 },
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = serviceWith(prisma, actor);

    await expect(service.archiveRole('actor-user', 'project', 'owner-role', 1)).rejects.toThrow(
      'owner role cannot be archived',
    );
  });

  it('uses the membership version to reject a stale role assignment', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'editor-role',
          isOwner: false,
          permissions: [{ permission: 'read_project' }],
        }),
      },
      projectMembership: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      projectMembership: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'member',
          userId: 'member-user',
          role: { isOwner: false },
        }),
      },
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = serviceWith(prisma, actor);

    await expect(
      service.updateMembership('actor-user', 'project', 'member', 'editor-role', 4),
    ).rejects.toThrow('Membership has changed');
  });

  it('transfers ownership without rewriting either member workspace layout', async () => {
    const layoutWrite = vi.fn();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 'project', version: 3 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'project',
          ownerUserId: 'new-owner',
        }),
      },
      projectMembership: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'target',
          userId: 'new-owner',
          user: { status: 'ACTIVE' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      projectRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'admin-role' }),
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce({ id: 'owner-role' })
          .mockResolvedValueOnce({ id: 'admin-role' }),
      },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
      projectWorkspaceDefault: { update: layoutWrite },
      projectMembershipWorkspaceLayout: { updateMany: layoutWrite },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = {
      membership: vi.fn().mockResolvedValue({
        id: 'actor-membership',
        project: { ownerUserId: 'old-owner' },
      }),
    };
    const service = new ProjectsService(
      prisma as never,
      permissions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await service.transferOwnership('old-owner', 'project', 'target', 3);

    expect(layoutWrite).not.toHaveBeenCalled();
  });
});
