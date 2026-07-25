import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { issueScreenplayInvitation } from './screenplay-invitations';

function deps(role: object | null) {
  const invitationCreate = vi.fn(({ data }: { data: object }) =>
    Promise.resolve({ id: 'invitation-id', ...data }),
  );
  const tx = {
    screenplayRole: { findFirst: vi.fn().mockResolvedValue(role) },
    screenplayInvitation: { create: invitationCreate },
  };
  const prisma = {
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  return { deps: { prisma: prisma as never, db: db as never }, tx, invitationCreate };
}

const actor = { userId: 'inviter', permissions: [{ permission: 'read_screenplay' }] };

describe('issueScreenplayInvitation', () => {
  it('issues an invitation with a hashed token and a role the actor can grant', async () => {
    const { deps: dependencies, invitationCreate } = deps({
      id: 'role-id',
      permissions: [{ permission: 'read_screenplay' }],
    });

    const result = await issueScreenplayInvitation(
      dependencies,
      'screenplay-id',
      'role-id',
      'invitee@example.test',
      actor,
    );

    expect(typeof result.token).toBe('string');
    const persisted = invitationCreate.mock.calls[0]?.[0] as {
      data: {
        screenplayId: string;
        roleId: string;
        email: string;
        inviterId: string;
        tokenHash: string;
      };
    };
    expect(persisted.data).toMatchObject({
      screenplayId: 'screenplay-id',
      roleId: 'role-id',
      email: 'invitee@example.test',
      inviterId: 'inviter',
    });
    // The raw token is never persisted.
    expect(typeof persisted.data.tokenHash).toBe('string');
    expect(persisted.data.tokenHash).not.toBe(result.token);
  });

  it('rejects an unknown or archived role', async () => {
    const { deps: dependencies } = deps(null);

    await expect(
      issueScreenplayInvitation(dependencies, 'screenplay-id', 'role-id', 'x@example.test', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to grant a permission the actor does not hold', async () => {
    const { deps: dependencies } = deps({
      id: 'role-id',
      permissions: [{ permission: 'edit_screenplay' }],
    });

    await expect(
      issueScreenplayInvitation(dependencies, 'screenplay-id', 'role-id', 'x@example.test', actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
