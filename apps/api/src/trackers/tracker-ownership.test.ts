import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { transferTrackerOwnership } from './tracker-ownership';

interface Overrides {
  tracker?: object | null;
  target?: object | null;
  targetStatus?: string;
  demotionCandidate?: object | null;
  claimCount?: number;
}

function harness(overrides: Overrides = {}) {
  const membershipUpdate = vi.fn().mockResolvedValue({});
  const tx = {
    tracker: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides.tracker === undefined ? { id: 'tracker-id', version: 1 } : overrides.tracker,
        ),
      updateMany: vi.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'tracker-id', version: 2 }),
    },
    trackerMembership: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides.target === undefined
            ? { id: 'target-membership', userId: 'target-user' }
            : overrides.target,
        ),
      update: membershipUpdate,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ status: overrides.targetStatus ?? 'ACTIVE' }),
    },
    trackerRole: {
      findFirstOrThrow: vi
        .fn()
        .mockResolvedValueOnce({ id: 'owner-role' })
        .mockResolvedValueOnce({ id: 'demotion-role' }),
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides.demotionCandidate === undefined
            ? { id: 'demotion-role' }
            : overrides.demotionCandidate,
        ),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  return { tx, membershipUpdate, prisma: prisma as never, db: db as never };
}

const input = {
  userId: 'owner-user',
  trackerId: 'tracker-id',
  membershipId: 'target-membership',
  actorMembershipId: 'actor-membership',
  version: 1,
};

describe('transferTrackerOwnership', () => {
  it('swaps the owner-role memberships atomically without moving ownerUserId', async () => {
    const { db, prisma, tx, membershipUpdate } = harness();

    await transferTrackerOwnership(db, prisma, input);

    // The claim bumps only the version — access-ownership is the isOwner role membership.
    expect(tx.tracker.updateMany).toHaveBeenCalledWith({
      where: { id: 'tracker-id', version: 1 },
      data: { version: { increment: 1 } },
    });
    // Previous owner demoted first, then the target promoted to the owner role.
    expect(membershipUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'actor-membership' },
      data: { roleId: 'demotion-role', version: { increment: 1 } },
    });
    expect(membershipUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'target-membership' },
      data: { roleId: 'owner-role', version: { increment: 1 } },
    });
  });

  it('refuses to transfer to a disabled account', async () => {
    const { db, prisma } = harness({
      target: { id: 'target-membership', userId: 'target-user' },
      targetStatus: 'DISABLED',
    });

    await expect(transferTrackerOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a self-transfer', async () => {
    const { db, prisma } = harness({
      target: { id: 'actor-membership', userId: 'owner-user' },
    });

    await expect(transferTrackerOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses when no active role is available to demote the previous owner into', async () => {
    const { db, prisma } = harness({ demotionCandidate: null });

    await expect(transferTrackerOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reports a concurrent version change as a conflict', async () => {
    const { db, prisma } = harness({ claimCount: 0 });

    await expect(transferTrackerOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reports a vanished tracker or membership as a conflict', async () => {
    const { db, prisma } = harness({ target: null });

    await expect(transferTrackerOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
