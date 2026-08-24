import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { issueTrackerInvitation } from './tracker-invitations';

function deps(role: object | null) {
  const invitationCreate = vi.fn(({ data }: { data: object }) =>
    Promise.resolve({ id: 'invitation-id', ...data }),
  );
  const tx = {
    trackerRole: { findFirst: vi.fn().mockResolvedValue(role) },
    trackerInvitation: { create: invitationCreate },
  };
  const prisma = {
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  const activity = { invitationCreated: vi.fn().mockResolvedValue(undefined) };
  return {
    deps: { prisma: prisma as never, db: db as never, activity: activity as never },
    tx,
    invitationCreate,
    activity,
  };
}

const actor = { userId: 'inviter', permissions: [{ permission: 'read_tracker' }] };

describe('issueTrackerInvitation', () => {
  it('issues an invitation with a hashed token and a seven-day expiry', async () => {
    const { deps: dependencies, invitationCreate } = deps({
      id: 'role-id',
      permissions: [{ permission: 'read_tracker' }],
    });

    const result = await issueTrackerInvitation(
      dependencies,
      'tracker-id',
      'role-id',
      'invitee@example.test',
      actor,
    );

    expect(typeof result.token).toBe('string');
    const persisted = invitationCreate.mock.calls[0]?.[0] as {
      data: {
        trackerId: string;
        roleId: string;
        email: string;
        inviterId: string;
        tokenHash: string;
        expiresAt: Date;
      };
    };
    expect(persisted.data).toMatchObject({
      trackerId: 'tracker-id',
      roleId: 'role-id',
      email: 'invitee@example.test',
      inviterId: 'inviter',
    });
    // The raw token is never persisted; only its SHA-256 hash is.
    expect(typeof persisted.data.tokenHash).toBe('string');
    expect(persisted.data.tokenHash).not.toBe(result.token);
    expect(persisted.data.tokenHash).toHaveLength(64);
    const expectedExpiry = Date.now() + 7 * 86_400_000;
    expect(persisted.data.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 1000);
    expect(persisted.data.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 1000);
  });

  it('rejects an unknown or archived role', async () => {
    const { deps: dependencies } = deps(null);

    await expect(
      issueTrackerInvitation(dependencies, 'tracker-id', 'role-id', 'x@example.test', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to issue for the owner role', async () => {
    // The lifecycle helper filters isOwner out of the lookup, so an owner role resolves to null.
    const { deps: dependencies } = deps(null);
    const ownerActor = {
      userId: 'inviter',
      permissions: [{ permission: 'read_tracker' }, { permission: 'manage_roles' }],
    };

    await expect(
      issueTrackerInvitation(
        dependencies,
        'tracker-id',
        'owner-role',
        'x@example.test',
        ownerActor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to grant a permission the actor does not hold', async () => {
    const { deps: dependencies } = deps({
      id: 'role-id',
      permissions: [{ permission: 'edit_tracker_records' }],
    });

    await expect(
      issueTrackerInvitation(dependencies, 'tracker-id', 'role-id', 'x@example.test', actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
