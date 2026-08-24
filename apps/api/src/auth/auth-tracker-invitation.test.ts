import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDatabaseCapabilities } from '../database/postgres-database-capabilities';
import { AuthService } from './auth.service';

const advisoryDb = new PostgresDatabaseCapabilities({} as never);

beforeEach(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
});

describe('AuthService tracker invitation acceptance', () => {
  it('previews and accepts a pending tracker invitation for a signed-in account', async () => {
    const user = { id: '40000000-0000-4000-8000-000000000001', email: 'member@example.test' };
    const invitation = {
      id: '40000000-0000-4000-8000-000000000002',
      email: user.email,
      trackerId: '40000000-0000-4000-8000-000000000003',
      roleId: '40000000-0000-4000-8000-000000000004',
      status: 'PENDING',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      role: { id: '40000000-0000-4000-8000-000000000004', name: 'editor' },
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      trackerRole: {
        findFirst: vi.fn().mockResolvedValue({ id: invitation.roleId, permissions: [] }),
      },
      trackerInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      trackerMembership: { upsert: vi.fn().mockResolvedValue({ id: 'membership' }) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      spaceInvitation: undefined,
      trackerInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      tracker: {
        findFirst: vi.fn().mockResolvedValue({ id: invitation.trackerId, name: 'Stunt Tracker' }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(prisma as never, advisoryDb);

    await expect(service.invitation('a'.repeat(64))).resolves.toMatchObject({
      kind: 'tracker',
      email: user.email,
      tracker: { id: invitation.trackerId, name: 'Stunt Tracker' },
      role: { id: invitation.roleId, name: 'editor' },
    });
    await service.acceptInvitation({ token: 'a'.repeat(64) }, user.id);

    const update = tx.trackerInvitation.updateMany.mock.calls[0]?.[0] as unknown as {
      data: { status: string; acceptedById: string };
    };
    expect(update.data.status).toBe('ACCEPTED');
    expect(update.data.acceptedById).toBe(user.id);
    expect(tx.trackerMembership.upsert).toHaveBeenCalledWith({
      where: { trackerId_userId: { trackerId: invitation.trackerId, userId: user.id } },
      create: { trackerId: invitation.trackerId, userId: user.id, roleId: invitation.roleId },
      update: {},
    });
  });

  it('rejects an expired tracker invitation as invalid', async () => {
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      spaceInvitation: undefined,
      trackerInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invitation',
          email: 'invitee@example.test',
          trackerId: 'tracker-id',
          roleId: 'role-id',
          status: 'PENDING',
          revokedAt: null,
          expiresAt: new Date(Date.now() - 60_000),
        }),
      },
    };
    const service = new AuthService(prisma as never, advisoryDb);

    await expect(service.invitation('b'.repeat(64))).rejects.toThrow(
      'Invitation is invalid or expired',
    );
  });
});
