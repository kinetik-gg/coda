import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash } from 'argon2';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.S3_ENDPOINT = 'http://localhost:9000';
  process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
  process.env.S3_BUCKET = 'test-bucket';
  process.env.S3_ACCESS_KEY = 'test-access-key';
  process.env.S3_SECRET_KEY = 'test-secret-key';
});

describe('AuthService setup and sessions', () => {
  it.each([
    [0, false],
    [1, true],
  ])('reports initialization from instance settings count', async (count, initialized) => {
    const service = new AuthService({
      instanceSettings: { count: vi.fn().mockResolvedValue(count) },
    } as never);
    await expect(service.setupStatus()).resolves.toMatchObject({ initialized });
  });

  it('creates the first owner while normalizing optional profile values', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      instanceSettings: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
      user: { create: vi.fn().mockResolvedValue({ id: 'owner', email: 'owner@example.test' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(prisma as never);
    await expect(
      service.setupOwner({
        displayName: 'Owner',
        email: 'owner@example.test',
        password: 'strong-password',
        company: '  Studio  ',
        department: null,
      }),
    ).resolves.toMatchObject({ id: 'owner' });
    const createCall = tx.user.create.mock.calls[0]?.[0] as unknown as {
      data: { passwordHash: string; company: string; department: null };
    };
    expect(createCall.data.passwordHash).not.toBe('strong-password');
    expect(createCall.data.company).toBe('Studio');
    expect(createCall.data.department).toBeNull();
    expect(tx.instanceSettings.create).toHaveBeenCalledWith({ data: { ownerUserId: 'owner' } });
  });

  it('prevents setup after initialization', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      instanceSettings: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new AuthService({
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never);
    await expect(
      service.setupOwner({
        displayName: 'Owner',
        email: 'owner@example.test',
        password: 'strong-password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('authenticates active accounts and rejects absent, disabled, or invalid credentials', async () => {
    const passwordHash = await hash('correct-password', { type: 2 });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'user', status: 'ACTIVE', passwordHash })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'disabled', status: 'DISABLED', passwordHash })
      .mockResolvedValueOnce({ id: 'user', status: 'ACTIVE', passwordHash });
    const service = new AuthService({ user: { findUnique } } as never);
    await expect(service.login('user@example.test', 'correct-password')).resolves.toMatchObject({
      id: 'user',
    });
    await expect(service.login('missing@example.test', 'correct-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.login('disabled@example.test', 'correct-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.login('user@example.test', 'wrong-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('creates a hashed session token plus an independent CSRF token and logs out idempotently', async () => {
    const session = { id: 'session' };
    const create = vi.fn().mockResolvedValue(session);
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new AuthService({ session: { create, deleteMany } } as never);
    const result = await service.createSession('user');
    expect(result.session).toBe(session);
    expect(result.token).not.toBe(result.csrf);
    const createCall = create.mock.calls[0]?.[0] as unknown as {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    };
    expect(createCall.data.userId).toBe('user');
    expect(createCall.data.tokenHash).not.toBe(result.token);
    expect(createCall.data.expiresAt).toBeInstanceOf(Date);
    await service.logout();
    expect(deleteMany).not.toHaveBeenCalled();
    await service.logout('session');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'session' } });
  });
});

describe('AuthService invitation descriptions and validation', () => {
  const token = 'a'.repeat(64);

  it('describes a valid project invitation without falling through to instance lookup', async () => {
    const invitation = {
      status: 'PENDING',
      email: 'member@example.test',
      expiresAt: new Date(Date.now() + 60_000),
      project: { id: 'project', name: 'Project' },
      role: { id: 'role', name: 'Viewer' },
    };
    const instanceFind = vi.fn();
    const service = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      instanceInvitation: { findUnique: instanceFind },
    } as never);
    await expect(service.invitation(token)).resolves.toEqual({
      kind: 'project',
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      project: invitation.project,
      role: invitation.role,
    });
    expect(instanceFind).not.toHaveBeenCalled();
  });

  it('rejects expired project and revoked or absent instance invitations', async () => {
    const expiredProject = new AuthService({
      projectInvitation: {
        findUnique: vi.fn().mockResolvedValue({ status: 'PENDING', expiresAt: new Date(0) }),
      },
    } as never);
    await expect(expiredProject.invitation(token)).rejects.toBeInstanceOf(NotFoundException);

    const revokedInstance = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'PENDING',
          revokedAt: new Date(),
          expiresAt: null,
        }),
      },
    } as never);
    await expect(revokedInstance.invitation(token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not describe or accept an invitation for a trashed project', async () => {
    const trashedProjectInvitation = {
      id: 'invitation',
      projectId: 'project',
      roleId: 'role',
      email: 'member@example.test',
      status: 'PENDING',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      project: { id: 'project', name: 'Trashed', deletedAt: new Date() },
      role: { id: 'role', name: 'Viewer' },
    };
    const service = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(trashedProjectInvitation) },
    } as never);

    await expect(service.invitation(token)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.acceptInvitation({ token }, 'user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('describes a reusable invitation as bulk and hides its email binding', async () => {
    const instance = {
      status: 'PENDING',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      isReusable: true,
      email: 'must-not-leak@example.test',
      project: null,
      role: null,
    };
    const service = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: { findUnique: vi.fn().mockResolvedValue(instance) },
    } as never);
    await expect(service.invitation(token)).resolves.toEqual({
      kind: 'bulk_instance',
      email: null,
      expiresAt: instance.expiresAt,
      project: null,
      role: null,
    });
  });

  it('requires account details for a new project invitee and sign-in for an existing one', async () => {
    const invitation = {
      id: 'invitation',
      email: 'member@example.test',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      projectId: 'project',
      roleId: 'role',
    };
    const newUser = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);
    await expect(newUser.acceptInvitation({ token })).rejects.toBeInstanceOf(BadRequestException);
    const existing = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: { findUnique: vi.fn().mockResolvedValue({ email: invitation.email }) },
    } as never);
    await expect(existing.acceptInvitation({ token })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects signed-in users whose email does not match an instance invitation', async () => {
    const service = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invitation',
          email: 'member@example.test',
          status: 'PENDING',
          revokedAt: null,
          expiresAt: null,
          isReusable: false,
          projectId: null,
          roleId: null,
        }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'different@example.test' }) },
    } as never);
    await expect(service.acceptInvitation({ token }, 'user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires an email before redeeming a reusable invitation', async () => {
    const service = new AuthService({
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      instanceInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invitation',
          email: null,
          status: 'PENDING',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          isReusable: true,
          projectId: null,
          roleId: null,
        }),
      },
    } as never);
    await expect(service.acceptInvitation({ token })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AuthService account operations', () => {
  it('reads the account projection and writes preference field mappings', async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: 'user' });
    const update = vi.fn().mockResolvedValue({ theme: 'dark' });
    const service = new AuthService({ user: { findUniqueOrThrow, update } } as never);
    await expect(service.account('user')).resolves.toEqual({ id: 'user' });
    await expect(
      service.updateAccountPreferences('user', {
        theme: 'dark',
        fontSize: 'large',
        motion: 'reduced',
        pdfAppearance: 'sepia',
      }),
    ).resolves.toEqual({ theme: 'dark' });
    const updateCall = update.mock.calls[0]?.[0] as unknown as { data: Record<string, unknown> };
    expect(updateCall.data).toEqual({
      theme: 'dark',
      fontSize: 'large',
      motionPreference: 'reduced',
      pdfAppearance: 'sepia',
    });
  });

  it('preserves omitted profile values while trimming supplied values', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'user' });
    const service = new AuthService({ user: { update } } as never);
    await service.updateAccountProfile('user', {
      displayName: 'Display',
      email: 'user@example.test',
      department: '  Art  ',
    });
    const updateCall = update.mock.calls[0]?.[0] as unknown as { data: Record<string, unknown> };
    expect(updateCall.data).toEqual({
      displayName: 'Display',
      email: 'user@example.test',
      department: 'Art',
    });
    expect(updateCall.data).not.toHaveProperty('company');
  });

  it('rejects password changes for absent users or incorrect current passwords', async () => {
    const absent = new AuthService({
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);
    await expect(
      absent.changeAccountPassword('user', undefined, 'current', 'next-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const passwordHash = await hash('actual-current', { type: 2 });
    const wrong = new AuthService({
      user: { findUnique: vi.fn().mockResolvedValue({ passwordHash }) },
    } as never);
    await expect(
      wrong.changeAccountPassword('user', undefined, 'wrong', 'next-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects administrator resets for an absent target user', async () => {
    const service = new AuthService({
      instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);
    await expect(
      service.administratorResetPassword('owner', 'missing', 'next-password'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
