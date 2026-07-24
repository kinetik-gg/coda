import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash } from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { PostgresDatabaseCapabilities } from '../database/postgres-database-capabilities';
import { AuthService } from './auth.service';
import { createDefaultWorkspaceLayout } from '../workspace-layouts/default-workspace-layout';

const advisoryDb = new PostgresDatabaseCapabilities({} as never);

describe('AuthService invitation workspace inheritance', () => {
  it('creates a missing personal layout from the current project default', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'member@example.test',
    };
    const invitation = {
      id: '10000000-0000-4000-8000-000000000002',
      projectId: '10000000-0000-4000-8000-000000000003',
      roleId: '10000000-0000-4000-8000-000000000004',
      email: user.email,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const layout = createDefaultWorkspaceLayout();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: { findFirst: vi.fn().mockResolvedValue({ id: invitation.roleId }) },
      projectInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      projectMembership: {
        upsert: vi.fn().mockResolvedValue({
          id: '10000000-0000-4000-8000-000000000005',
        }),
      },
      projectWorkspaceDefault: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          projectId: invitation.projectId,
          layout,
          schemaVersion: 1,
          revision: 7,
        }),
      },
      projectMembershipWorkspaceLayout: { upsert: vi.fn().mockResolvedValue({}) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(prisma as never, advisoryDb);

    await service.acceptInvitation({ token: 'a'.repeat(64) }, user.id);

    const projectAcceptance = tx.projectInvitation.updateMany.mock.calls[0]![0] as unknown as {
      where: {
        status: string;
        revokedAt: null;
        expiresAt: { gt: Date };
        project: { deletedAt: null };
      };
    };
    expect(projectAcceptance.where).toMatchObject({
      status: 'PENDING',
      revokedAt: null,
      project: { deletedAt: null },
    });
    expect(projectAcceptance.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectRole.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(tx.projectRole.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectInvitation.updateMany.mock.invocationCallOrder[0]!,
    );

    const layoutUpsert = tx.projectMembershipWorkspaceLayout.upsert.mock
      .calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(layoutUpsert).toMatchObject({
      where: { membershipId: '10000000-0000-4000-8000-000000000005' },
      create: {
        membershipId: '10000000-0000-4000-8000-000000000005',
        layout,
        schemaVersion: 1,
        basedOnDefaultRevision: 7,
      },
      update: {},
    });
  });

  it('accepts an email-bound instance invitation without creating a project membership', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'member@example.test',
    };
    const tx = {
      instanceInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: '10000000-0000-4000-8000-000000000002',
          email: user.email,
          status: 'PENDING',
          revokedAt: null,
          expiresAt: null,
          projectId: null,
          roleId: null,
        }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      new AuthService(prisma as never, advisoryDb).acceptInvitation(
        { token: 'a'.repeat(64) },
        user.id,
      ),
    ).resolves.toEqual(user);
    const acceptance = tx.instanceInvitation.updateMany.mock.calls[0]![0] as unknown as {
      data: { status: string; acceptedById: string };
    };
    expect(acceptance.data).toMatchObject({ status: 'ACCEPTED', acceptedById: user.id });
    const instanceAcceptance = tx.instanceInvitation.updateMany.mock.calls[0]![0] as unknown as {
      where: {
        status: string;
        revokedAt: null;
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: Date } }] },
          { OR: [{ projectId: null }, { project: { deletedAt: null } }] },
        ];
      };
    };
    expect(instanceAcceptance.where.status).toBe('PENDING');
    expect(instanceAcceptance.where.revokedAt).toBeNull();
    expect(instanceAcceptance.where.AND[0].OR[0]).toEqual({ expiresAt: null });
    expect(instanceAcceptance.where.AND[1]).toEqual({
      OR: [{ projectId: null }, { project: { deletedAt: null } }],
    });
    expect(instanceAcceptance.where.AND[0].OR[1].expiresAt.gt).toBeInstanceOf(Date);
  });

  it('atomically assigns an accepted instance invitation to its selected project role', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'member@example.test',
    };
    const projectId = '10000000-0000-4000-8000-000000000003';
    const roleId = '10000000-0000-4000-8000-000000000004';
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: { findFirst: vi.fn().mockResolvedValue({ id: roleId }) },
      instanceInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      projectMembership: {
        upsert: vi.fn().mockResolvedValue({ id: '10000000-0000-4000-8000-000000000005' }),
      },
      projectWorkspaceDefault: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          layout: createDefaultWorkspaceLayout(),
          schemaVersion: 1,
          revision: 3,
        }),
      },
      projectMembershipWorkspaceLayout: { upsert: vi.fn().mockResolvedValue({}) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: '10000000-0000-4000-8000-000000000002',
          email: user.email,
          status: 'PENDING',
          revokedAt: null,
          expiresAt: null,
          projectId,
          roleId,
        }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };

    await new AuthService(prisma as never, advisoryDb).acceptInvitation(
      { token: 'a'.repeat(64) },
      user.id,
    );

    expect(tx.projectMembership.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId, userId: user.id } },
      create: { projectId, userId: user.id, roleId },
      update: {},
    });
    expect(tx.projectMembershipWorkspaceLayout.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { membershipId: '10000000-0000-4000-8000-000000000005' },
      }),
    );
  });

  it('describes a non-expiring instance invitation as instance-scoped', async () => {
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          email: 'member@example.test',
          status: 'PENDING',
          revokedAt: null,
          expiresAt: null,
          project: null,
          role: null,
        }),
      },
    };

    await expect(
      new AuthService(prisma as never, advisoryDb).invitation('a'.repeat(64)),
    ).resolves.toEqual({
      kind: 'instance',
      email: 'member@example.test',
      expiresAt: null,
      project: null,
      role: null,
    });
  });

  it('redeems a reusable invitation without consuming it for other users', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'member@example.test',
    };
    const bulkInvitation = {
      id: '10000000-0000-4000-8000-000000000002',
      email: null,
      isReusable: true,
      status: 'PENDING',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      projectId: null,
      roleId: null,
    };
    const tx = {
      instanceInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue(bulkInvitation),
      },
      instanceInvitationRedemption: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: { findUnique: vi.fn().mockResolvedValue(bulkInvitation) },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      new AuthService(prisma as never, advisoryDb).acceptInvitation(
        { token: 'a'.repeat(64), email: user.email },
        user.id,
      ),
    ).resolves.toEqual(user);

    expect(tx.instanceInvitationRedemption.create).toHaveBeenCalledWith({
      data: { invitationId: bulkInvitation.id, userId: user.id, email: user.email },
    });
    const reusableClaimInput: unknown = tx.instanceInvitation.updateMany.mock.calls[0]?.[0];
    expect(reusableClaimInput).toMatchObject({
      where: { id: bulkInvitation.id, status: 'PENDING' },
      data: { revokedAt: null },
    });
  });

  it('does not redeem a reusable invitation after its atomic active-state claim loses', async () => {
    const invitation = {
      id: 'invitation',
      email: null,
      isReusable: true,
      status: 'PENDING',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      projectId: null,
      roleId: null,
    };
    const createRedemption = vi.fn();
    const tx = {
      instanceInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn(),
      },
      instanceInvitationRedemption: { create: createRedemption },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user', email: 'member@example.test' }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      new AuthService(prisma as never, advisoryDb).acceptInvitation(
        { token: 'a'.repeat(64), email: 'member@example.test' },
        'user',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.instanceInvitation.findFirst).not.toHaveBeenCalled();
    expect(createRedemption).not.toHaveBeenCalled();
  });

  it('normalizes empty optional profile values to null', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'user-id', company: null });
    const service = new AuthService({ user: { update } } as never, advisoryDb);

    await service.updateAccountProfile('user-id', { company: '   ' });

    const profileUpdate = update.mock.calls[0]![0] as unknown as { data: { company: null } };
    expect(profileUpdate.data.company).toBeNull();
  });
});

describe('AuthService password reset and change', () => {
  it('does not let a non-administrator reset another user password', async () => {
    const service = new AuthService(
      {
        instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
      } as never,
      advisoryDb,
    );

    await expect(
      service.administratorResetPassword('member', 'target', 'new-password-value'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invalidates prior reset links before issuing a replacement', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: vi.fn().mockImplementation(() => {
        calls.push('lock');
        return Promise.resolve(1);
      }),
      passwordResetToken: {
        updateMany: vi.fn().mockImplementation(() => {
          calls.push('invalidate');
          return Promise.resolve({ count: 2 });
        }),
        create: vi.fn().mockImplementation((input: { data: Record<string, unknown> }) => {
          calls.push('create');
          return Promise.resolve({ id: 'reset-id', ...input.data });
        }),
      },
    };
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-id' }) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };

    await new AuthService(prisma as never, advisoryDb).createResetLink('owner', 'user-id');

    expect(calls).toEqual(['lock', 'invalidate', 'create']);
    const invalidation = tx.passwordResetToken.updateMany.mock.calls[0]![0] as unknown as {
      where: { userId: string; usedAt: null };
      data: { usedAt: Date };
    };
    expect(invalidation.where).toEqual({ userId: 'user-id', usedAt: null });
    expect(invalidation.data.usedAt).toBeInstanceOf(Date);
  });

  it('allows only one concurrent request to consume a reset link', async () => {
    const reset = {
      id: 'reset-id',
      userId: 'user-id',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { email: 'member@example.test' },
    };
    let consumed = false;
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      passwordResetToken: {
        updateMany: vi.fn().mockImplementation(({ where }: { where: { id?: string } }) => {
          if (!where.id) return Promise.resolve({ count: 1 });
          if (consumed) return Promise.resolve({ count: 0 });
          consumed = true;
          return Promise.resolve({ count: 1 });
        }),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      passwordResetToken: { findUnique: vi.fn().mockResolvedValue(reset) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(prisma as never, advisoryDb);

    const results = await Promise.allSettled([
      service.resetPassword('a'.repeat(64), 'replacement-password'),
      service.resetPassword('a'.repeat(64), 'replacement-password'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection?.status).toBe('rejected');
    if (rejection?.status === 'rejected')
      expect(rejection.reason).toBeInstanceOf(NotFoundException);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.session.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a reset password that contains the account email local part', async () => {
    const reset = {
      id: 'reset-id',
      userId: 'user-id',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { email: 'rizki@example.test' },
    };
    const prisma = {
      passwordResetToken: { findUnique: vi.fn().mockResolvedValue(reset) },
      $transaction: vi.fn(),
    };
    const service = new AuthService(prisma as never, advisoryDb);

    await expect(service.resetPassword('a'.repeat(64), 'has-rizki-in-it')).rejects.toThrow(
      /email/i,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('invalidates reset links when an account password is changed', async () => {
    const currentPassword = 'current-password';
    const passwordHash = await hash(currentPassword, { type: 2 });
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      user: {
        update: vi.fn().mockResolvedValue({}),
      },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      passwordResetToken: { updateMany },
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-id', passwordHash }) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };

    await new AuthService(prisma as never, advisoryDb).changeAccountPassword(
      'user-id',
      'current-session',
      currentPassword,
      'replacement-password',
    );

    const invalidation = updateMany.mock.calls[0]![0] as unknown as {
      where: { userId: string; usedAt: null };
      data: { usedAt: Date };
    };
    expect(invalidation.where).toEqual({ userId: 'user-id', usedAt: null });
    expect(invalidation.data.usedAt).toBeInstanceOf(Date);
  });

  it('invalidates reset links when an administrator sets a password', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      user: {
        update: vi.fn().mockResolvedValue({}),
      },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      passwordResetToken: { updateMany },
    };
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-id' }) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };

    await new AuthService(prisma as never, advisoryDb).administratorResetPassword(
      'owner',
      'user-id',
      'replacement-password',
    );

    const invalidation = updateMany.mock.calls[0]![0] as unknown as {
      where: { userId: string; usedAt: null };
      data: { usedAt: Date };
    };
    expect(invalidation.where).toEqual({ userId: 'user-id', usedAt: null });
    expect(invalidation.data.usedAt).toBeInstanceOf(Date);
  });
});

describe('AuthService negative authentication and invitation paths', () => {
  it.each([
    ['missing account', null, 'password'],
    ['disabled account', { status: 'DISABLED', passwordHash: 'unused' }, 'password'],
  ])('rejects login for a %s', async (_label, user, password) => {
    const service = new AuthService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(user) },
      } as never,
      advisoryDb,
    );
    await expect(service.login('person@example.test', password)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a verified active account and manages optional session logout', async () => {
    const passwordHash = await hash('correct-password', { type: 2 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new AuthService(
      {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'user', status: 'ACTIVE', passwordHash }),
        },
        session: { deleteMany },
      } as never,
      advisoryDb,
    );

    await expect(service.login('person@example.test', 'correct-password')).resolves.toMatchObject({
      id: 'user',
    });
    await service.logout();
    expect(deleteMany).not.toHaveBeenCalled();
    await service.logout('session');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'session' } });
  });

  it('rejects expired project invitations and describes reusable instance invitations', async () => {
    const projectInvitation = {
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1_000),
    };
    const prisma = {
      projectInvitation: {
        findUnique: vi.fn().mockResolvedValueOnce(projectInvitation).mockResolvedValueOnce(null),
      },
      instanceInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'PENDING',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          isReusable: true,
          project: null,
          role: null,
        }),
      },
    };
    const service = new AuthService(prisma as never, advisoryDb);

    await expect(service.invitation('a'.repeat(64))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.invitation('b'.repeat(64))).resolves.toMatchObject({
      kind: 'bulk_instance',
      email: null,
    });
  });

  it.each([
    ['absent', null],
    ['revoked', { status: 'PENDING', revokedAt: new Date(), expiresAt: null }],
    ['expired', { status: 'PENDING', revokedAt: null, expiresAt: new Date(Date.now() - 1_000) }],
  ])('rejects an %s instance invitation', async (_label, invitation) => {
    const service = new AuthService(
      {
        projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
        instanceInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      } as never,
      advisoryDb,
    );
    await expect(service.invitation('a'.repeat(64))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires identity details for new single-use and reusable invitation accounts', async () => {
    const singleUse = {
      id: 'invitation',
      email: 'new@example.test',
      isReusable: false,
      status: 'PENDING',
      revokedAt: null,
      expiresAt: null,
      projectId: null,
      roleId: null,
    };
    const reusable = { ...singleUse, email: null, isReusable: true };
    const projectInvitation = { findUnique: vi.fn().mockResolvedValue(null) };
    const user = { findUnique: vi.fn().mockResolvedValue(null) };

    await expect(
      new AuthService(
        {
          projectInvitation,
          instanceInvitation: { findUnique: vi.fn().mockResolvedValue(singleUse) },
          user,
        } as never,
        advisoryDb,
      ).acceptInvitation({ token: 'a'.repeat(64) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      new AuthService(
        {
          projectInvitation,
          instanceInvitation: { findUnique: vi.fn().mockResolvedValue(reusable) },
          user,
        } as never,
        advisoryDb,
      ).acceptInvitation({ token: 'b'.repeat(64) }),
    ).rejects.toThrow('Email is required');
  });

  it('prevents a signed-in account from accepting another email address invitation', async () => {
    const invitation = {
      id: 'invitation',
      email: 'invited@example.test',
      isReusable: false,
      status: 'PENDING',
      revokedAt: null,
      expiresAt: null,
      projectId: null,
      roleId: null,
    };
    const service = new AuthService(
      {
        projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
        instanceInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'user', email: 'other@example.test' }),
        },
      } as never,
      advisoryDb,
    );

    await expect(
      service.acceptInvitation({ token: 'a'.repeat(64) }, 'user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('detects a concurrently consumed project invitation', async () => {
    const invitation = {
      id: 'invitation',
      projectId: 'project',
      roleId: 'role',
      email: 'member@example.test',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: { findFirst: vi.fn().mockResolvedValue({ id: invitation.roleId }) },
      projectInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user', email: invitation.email }) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      new AuthService(prisma as never, advisoryDb).acceptInvitation(
        { token: 'a'.repeat(64) },
        'user',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not accept a project invitation after its role is archived', async () => {
    const invitation = {
      id: 'invitation',
      projectId: 'project',
      roleId: 'archived-role',
      email: 'member@example.test',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const updateMany = vi.fn();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: { findFirst: vi.fn().mockResolvedValue(null) },
      projectInvitation: { updateMany },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user', email: invitation.email }) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      new AuthService(prisma as never, advisoryDb).acceptInvitation(
        { token: 'a'.repeat(64) },
        'user',
      ),
    ).rejects.toThrow('role is no longer available');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('creates a new project invitee only inside the claim transaction', async () => {
    const invitation = {
      id: 'invitation',
      projectId: 'project',
      roleId: 'role',
      email: 'new-member@example.test',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const create = vi.fn().mockResolvedValue({ id: 'new-user', email: invitation.email });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      projectRole: { findFirst: vi.fn().mockResolvedValue({ id: invitation.roleId }) },
      user: { create },
      projectInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      new AuthService(prisma as never, advisoryDb).acceptInvitation({
        token: 'a'.repeat(64),
        displayName: 'New Member',
        password: 'password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).toHaveBeenCalledOnce();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects invalid reset links, wrong current passwords, and missing admin targets', async () => {
    const invalidReset = new AuthService(
      {
        passwordResetToken: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      advisoryDb,
    );
    await expect(invalidReset.resetPassword('a'.repeat(64), 'replacement')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const wrongPassword = new AuthService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      advisoryDb,
    );
    await expect(
      wrongPassword.changeAccountPassword('user', undefined, 'wrong', 'replacement'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const missingTarget = new AuthService(
      {
        instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      advisoryDb,
    );
    await expect(
      missingTarget.administratorResetPassword('owner', 'missing', 'replacement'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(missingTarget.createResetLink('owner', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates every optional profile field without emitting undefined properties', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'user' });
    await new AuthService({ user: { update } } as never, advisoryDb).updateAccountProfile('user', {
      displayName: 'Updated',
      email: 'updated@example.test',
      company: null,
      department: ' Design ',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          displayName: 'Updated',
          email: 'updated@example.test',
          company: null,
          department: 'Design',
        },
      }),
    );
  });
});
