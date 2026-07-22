import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InstanceManagementService } from './instance-management.service';

function ownerSettings() {
  return {
    ownerUserId: 'owner',
    owner: { id: 'owner', email: 'owner@example.test', displayName: 'Owner' },
  };
}

function service(prisma: object) {
  return new InstanceManagementService(prisma as never, { status: vi.fn() } as never);
}

describe('InstanceManagementService', () => {
  it('reports instance access without throwing for a regular active user', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
    };

    await expect(service(prisma).access('member')).resolves.toEqual({ isAdministrator: false });
  });

  it('reports no administrator when setup is absent', async () => {
    const prisma = { instanceSettings: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(service(prisma).access('member')).resolves.toEqual({ isAdministrator: false });
  });

  it('reports summary counts, zero-byte aggregates, and bounded list previews', async () => {
    const userCount = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const projectCount = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const storageAggregate = vi
      .fn()
      .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { sizeBytes: null } })
      .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { sizeBytes: null } });
    const prisma = {
      instanceSettings: {
        findFirst: vi.fn().mockResolvedValue({ ...ownerSettings(), initializedAt: new Date() }),
      },
      user: { count: userCount, findMany: vi.fn().mockResolvedValue([]) },
      project: { count: projectCount, findMany: vi.fn().mockResolvedValue([]) },
      storageObject: { aggregate: storageAggregate, findMany: vi.fn().mockResolvedValue([]) },
      session: { count: vi.fn().mockResolvedValue(4) },
      activityEvent: { findMany: vi.fn().mockResolvedValue([]) },
      instanceInvitation: { count: vi.fn().mockResolvedValue(5) },
    };

    const result = await service(prisma).summary('owner');

    expect(result.counts).toMatchObject({
      users: 3,
      activeUsers: 2,
      disabledUsers: 1,
      activeProjects: 2,
      trashedProjects: 1,
      storageBytes: 0n,
      trashedStorageBytes: 0n,
      activeSessions: 4,
      pendingInvitations: 5,
    });
    expect(result.listLimits).toEqual({
      users: 50,
      projects: 50,
      storageItems: 50,
      activities: 50,
    });
  });

  it('rejects users who are not the instance owner before reading management data', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findMany: vi.fn() },
    };

    await expect(service(prisma).summary('member')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('does not run management list queries for live status polling', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findMany: vi.fn() },
      project: { findMany: vi.fn() },
    };
    const result = await service(prisma).liveStatus('owner');

    expect(result.system.runtime.state).toBe('running');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('returns the documented manual-link invitation expiry choices', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      project: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await expect(service(prisma).invitationOptions('owner')).resolves.toEqual({
      delivery: 'manual_link',
      defaultExpiry: 'never',
      expiryChoices: [
        { id: 'never', label: 'Never expires' },
        { id: '30_days', label: '30 days' },
        { id: '7_days', label: '7 days' },
        { id: '24_hours', label: '24 hours' },
      ],
      projects: [],
    });
  });

  it('redacts sensitive metadata keys in the instance audit feed', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'activity-id',
            metadata: {
              roleId: 'role-id',
              email: 'invitee@example.test',
              nested: { token: 'secret', safe: 'visible' },
            },
          },
        ]),
      },
    };

    const result = await service(prisma).activities('owner', { limit: 50 });

    expect(result.items).toEqual([
      {
        id: 'activity-id',
        metadata: { roleId: 'role-id', nested: { safe: 'visible' } },
      },
    ]);
  });

  it('creates an email-bound instance invitation and defaults to no expiry', async () => {
    interface InvitationCreateInput {
      data: {
        email: string;
        inviterId: string;
        expiresAt: Date | null;
        tokenHash: string;
      };
    }
    const create = vi.fn().mockImplementation(({ data }: InvitationCreateInput) => ({
      id: 'invitation-id',
      status: 'PENDING',
      ...data,
    }));
    const transactionClient = { instanceInvitation: { updateMany: vi.fn(), create } };
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback: (client: typeof transactionClient) => unknown) =>
        callback(transactionClient),
      ),
    };

    const result = await service(prisma).invite('owner', {
      email: 'invitee@example.test',
      expiresIn: 'never',
    });

    const createInput = create.mock.calls[0]![0] as unknown as InvitationCreateInput;
    expect(createInput.data).toMatchObject({
      email: 'invitee@example.test',
      inviterId: 'owner',
      expiresAt: null,
    });
    expect(result.invitationUrl).toMatch(/^\/accept-invitation\?token=/);
  });

  it('does not invite an email that already belongs to a registered user', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing-user' }) },
    };

    await expect(
      service(prisma).invite('owner', {
        email: 'member@example.test',
        expiresIn: 'never',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores a validated project and non-owner role on an instance invitation', async () => {
    let storedInvitation: Record<string, unknown> | undefined;
    const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      storedInvitation = data;
      return { id: 'invitation-id', status: 'PENDING', ...data };
    });
    const transactionClient = { instanceInvitation: { updateMany: vi.fn(), create } };
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      projectRole: { findFirst: vi.fn().mockResolvedValue({ id: 'role-id' }) },
      $transaction: vi.fn((callback: (client: typeof transactionClient) => unknown) =>
        callback(transactionClient),
      ),
    };

    await service(prisma).invite('owner', {
      email: 'invitee@example.test',
      expiresIn: '7_days',
      projectId: 'project-id',
      roleId: 'role-id',
    });

    expect(prisma.projectRole.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'role-id',
        projectId: 'project-id',
        archivedAt: null,
        isOwner: false,
        project: { deletedAt: null },
      },
      select: { id: true },
    });
    expect(storedInvitation).toMatchObject({ projectId: 'project-id', roleId: 'role-id' });
  });

  it('rejects incomplete or stale project-role assignment for an invitation', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      projectRole: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const manager = service(prisma);
    await expect(
      manager.invite('owner', {
        email: 'invitee@example.test',
        expiresIn: 'never',
        projectId: 'project',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      manager.invite('owner', {
        email: 'invitee@example.test',
        expiresIn: 'never',
        projectId: 'project',
        roleId: 'role',
      }),
    ).rejects.toThrow('no longer available');
  });

  it('creates a reusable bulk invitation with a mandatory finite expiry', async () => {
    const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'bulk-invitation-id',
      status: 'PENDING',
      ...data,
    }));
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      instanceInvitation: { create },
    };

    const result = await service(prisma).bulkInvite('owner', { expiresIn: '24_hours' });

    const createInput = create.mock.calls[0]![0] as unknown as {
      data: { email: null; isReusable: boolean; inviterId: string; expiresAt: Date };
    };
    expect(createInput.data).toMatchObject({
      email: null,
      isReusable: true,
      inviterId: 'owner',
    });
    expect(createInput.data.expiresAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ isReusable: true, redemptionCount: 0 });
  });

  it('rejects incomplete and stale project-role assignment for reusable links', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      projectRole: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const manager = service(prisma);
    await expect(
      manager.bulkInvite('owner', { expiresIn: '7_days', roleId: 'role' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      manager.bulkInvite('owner', {
        expiresIn: '7_days',
        projectId: 'project',
        roleId: 'role',
      }),
    ).rejects.toThrow('no longer available');
  });

  it('paginates and derives expiration state for invitation listings', async () => {
    const now = Date.now();
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'expired',
        status: 'PENDING',
        expiresAt: new Date(now - 1_000),
        _count: { redemptions: 2 },
      },
      {
        id: 'accepted',
        status: 'ACCEPTED',
        expiresAt: null,
        _count: { redemptions: 1 },
      },
      { id: 'extra', status: 'PENDING', expiresAt: null, _count: { redemptions: 0 } },
    ]);
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      instanceInvitation: { findMany },
    };

    const result = await service(prisma).invitations('owner', {
      limit: 2,
      cursor: 'cursor',
      search: 'member',
    });

    expect(result.nextCursor).toBe('accepted');
    expect(result.items.map((item) => [item.id, item.status, item.redemptionCount])).toEqual([
      ['expired', 'EXPIRED', 2],
      ['accepted', 'ACCEPTED', 1],
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { contains: 'member', mode: 'insensitive' } },
        cursor: { id: 'cursor' },
        skip: 1,
        take: 3,
      }),
    );
  });

  it('updates user status, revoking sessions only when disabling', async () => {
    const tx = {
      user: {
        update: vi.fn().mockImplementation(({ data }: { data: { status: string } }) => ({
          id: 'member',
          ...data,
        })),
      },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    };
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'member' }) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const manager = service(prisma);

    await expect(manager.updateUserStatus('owner', 'member', 'DISABLED')).resolves.toMatchObject({
      sessionsRevoked: 3,
    });
    await expect(manager.updateUserStatus('owner', 'member', 'ACTIVE')).resolves.toMatchObject({
      sessionsRevoked: 0,
    });
    expect(tx.session.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('rejects status changes for an unknown account', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      service(prisma).updateUserStatus('owner', 'missing', 'ACTIVE'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revokes only a pending invitation and reports stale revocations', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      instanceInvitation: { updateMany },
    };
    const manager = service(prisma);
    await expect(manager.revokeInvitation('owner', 'invite')).resolves.toEqual({ revoked: true });
    await expect(manager.revokeInvitation('owner', 'invite')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('applies search, cursor, and pagination consistently to management lists', async () => {
    const rows = [
      { id: 'first', metadata: ['safe', { token: 'redacted', note: 'kept' }] },
      { id: 'second' },
    ];
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findMany: vi.fn().mockResolvedValue(rows) },
      project: { findMany: vi.fn().mockResolvedValue(rows) },
      storageObject: { findMany: vi.fn().mockResolvedValue(rows) },
      activityEvent: { findMany: vi.fn().mockResolvedValue(rows) },
    };
    const manager = service(prisma);
    const query = { limit: 1, cursor: 'cursor', search: 'needle' };

    await expect(manager.users('owner', query)).resolves.toMatchObject({ nextCursor: 'first' });
    await expect(manager.projectsList('owner', query)).resolves.toMatchObject({
      nextCursor: 'first',
    });
    await expect(manager.storage('owner', query)).resolves.toMatchObject({ nextCursor: 'first' });
    const activity = await manager.activities('owner', query);
    expect(activity.nextCursor).toBe('first');
    expect(activity.items[0]?.metadata).toEqual(['safe', { note: 'kept' }]);
    for (const findMany of [
      prisma.user.findMany,
      prisma.project.findMany,
      prisma.storageObject.findMany,
      prisma.activityEvent.findMany,
    ]) {
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'cursor' }, skip: 1, take: 2 }),
      );
    }
  });

  it('rejects management when instance setup is incomplete', async () => {
    const prisma = { instanceSettings: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(service(prisma).jobs('owner')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never disables the instance administrator account', async () => {
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue(ownerSettings()) },
      user: { findUnique: vi.fn() },
    };

    await expect(
      service(prisma).updateUserStatus('owner', 'owner', 'DISABLED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
