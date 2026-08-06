import { describe, expect, it, vi } from 'vitest';
import { PostgresDatabaseCapabilities } from '../database/postgres-database-capabilities';
import { AuthService } from './auth.service';

const advisoryDb = new PostgresDatabaseCapabilities({} as never);

describe('AuthService Space invitation acceptance', () => {
  it('previews and accepts a pending Space invitation for a signed-in account', async () => {
    const user = { id: '30000000-0000-4000-8000-000000000001', email: 'member@example.test' };
    const invitation = {
      id: '30000000-0000-4000-8000-000000000002',
      email: user.email,
      spaceId: '30000000-0000-4000-8000-000000000003',
      roleId: '30000000-0000-4000-8000-000000000004',
      status: 'PENDING',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      space: { id: '30000000-0000-4000-8000-000000000003', name: 'Production', deletedAt: null },
      role: { id: '30000000-0000-4000-8000-000000000004', name: 'contributor' },
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      spaceRole: {
        findFirst: vi.fn().mockResolvedValue({ id: invitation.roleId, permissions: [] }),
      },
      spaceInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      spaceMembership: { upsert: vi.fn().mockResolvedValue({ id: 'membership' }) },
    };
    const prisma = {
      projectInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
      spaceInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(prisma as never, advisoryDb);

    await expect(service.invitation('a'.repeat(64))).resolves.toMatchObject({
      kind: 'space',
      email: user.email,
      space: { id: invitation.spaceId, name: 'Production' },
      role: { id: invitation.roleId, name: 'contributor' },
    });
    await service.acceptInvitation({ token: 'a'.repeat(64) }, user.id);

    const update = tx.spaceInvitation.updateMany.mock.calls[0]?.[0] as unknown as {
      data: { status: string; acceptedById: string };
    };
    expect(update.data.status).toBe('ACCEPTED');
    expect(update.data.acceptedById).toBe(user.id);
    expect(tx.spaceMembership.upsert).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: invitation.spaceId, userId: user.id } },
      create: { spaceId: invitation.spaceId, userId: user.id, roleId: invitation.roleId },
      update: {},
    });
  });
});
