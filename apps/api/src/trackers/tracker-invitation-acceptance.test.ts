import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptTrackerInvitation,
  assertActiveTrackerInvitation,
  type TrackerInvitation,
} from './tracker-invitation-acceptance';

function activeInvitation(overrides: Partial<TrackerInvitation> = {}): TrackerInvitation {
  return {
    id: 'invitation-id',
    email: 'invitee@example.test',
    trackerId: 'tracker-id',
    roleId: 'role-id',
    status: 'PENDING',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

interface HarnessOverrides {
  role?: object | null;
  claimCount?: number;
}

function harness(overrides: HarnessOverrides = {}) {
  const user = { id: 'user-id', email: 'invitee@example.test' };
  const membershipUpsert = vi.fn().mockResolvedValue({});
  const tx = {
    trackerRole: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides.role === undefined
            ? { id: 'role-id', permissions: [{ permission: 'read_tracker' }] }
            : overrides.role,
        ),
    },
    trackerInvitation: {
      updateMany: vi.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
    },
    trackerMembership: { upsert: membershipUpsert },
    user: { create: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  return {
    deps: { prisma: prisma as never, db: db as never },
    tx,
    membershipUpsert,
    input: { displayName: 'Invitee', password: 'long-enough-password' },
  };
}

describe('assertActiveTrackerInvitation', () => {
  it('accepts a pending, unrevoked, unexpired invitation', () => {
    expect(() => assertActiveTrackerInvitation(activeInvitation())).not.toThrow();
  });

  it.each([
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ['revoked', { revokedAt: new Date() }],
    ['accepted', { status: 'ACCEPTED' }],
  ])('rejects an %s invitation as invalid', (_name, overrides) => {
    expect(() => assertActiveTrackerInvitation(activeInvitation(overrides))).toThrow(
      NotFoundException,
    );
  });
});

describe('acceptTrackerInvitation', () => {
  it('claims the invitation and upserts the membership in one transaction', async () => {
    const { deps, tx, membershipUpsert, input } = harness();

    const user = await acceptTrackerInvitation(deps, activeInvitation(), input, 'user-id');

    expect(user).toMatchObject({ id: 'user-id' });
    const claim = tx.trackerInvitation.updateMany.mock.calls[0]?.[0] as {
      where: { id: string; status: string };
      data: { status: string };
    };
    expect(claim.where).toMatchObject({ id: 'invitation-id', status: 'PENDING' });
    expect(claim.data.status).toBe('ACCEPTED');
    expect(membershipUpsert).toHaveBeenCalledWith({
      where: { trackerId_userId: { trackerId: 'tracker-id', userId: 'user-id' } },
      create: { trackerId: 'tracker-id', userId: 'user-id', roleId: 'role-id' },
      update: {},
    });
  });

  it('reports an already-used invitation as a conflict without granting access', async () => {
    const { deps, membershipUpsert, input } = harness({ claimCount: 0 });

    await expect(
      acceptTrackerInvitation(deps, activeInvitation(), input, 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(membershipUpsert).not.toHaveBeenCalled();
  });

  it('refuses acceptance when the role is no longer available', async () => {
    const { deps, membershipUpsert, input } = harness({ role: null });

    await expect(
      acceptTrackerInvitation(deps, activeInvitation(), input, 'user-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(membershipUpsert).not.toHaveBeenCalled();
  });
});
