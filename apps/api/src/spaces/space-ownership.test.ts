import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { transferSpaceOwnership } from './space-ownership';

interface Overrides {
  space?: object | null;
  target?: object | null;
  targetStatus?: string;
  demotionCandidate?: object | null;
  claimCount?: number;
}

function harness(overrides: Overrides = {}) {
  const membershipUpdate = vi.fn().mockResolvedValue({});
  const tx = {
    space: {
      findFirst: vi
        .fn()
        .mockResolvedValue(overrides.space === undefined ? { isDefault: false } : overrides.space),
      updateMany: vi.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'space-id', version: 2 }),
    },
    spaceMembership: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides.target === undefined
            ? { id: 'target-membership', userId: 'target-user' }
            : overrides.target,
        ),
      update: membershipUpdate,
    },
    user: { findUnique: vi.fn().mockResolvedValue({ status: overrides.targetStatus ?? 'ACTIVE' }) },
    spaceRole: {
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
  const prisma = { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  return { db: db as never, membershipUpdate, prisma: prisma as never, tx };
}

const input = {
  userId: 'owner-user',
  spaceId: 'space-id',
  membershipId: 'target-membership',
  actorMembershipId: 'owner-membership',
  version: 1,
};

describe('transferSpaceOwnership', () => {
  it('moves the owner membership, demotes the previous owner, and updates ownerUserId', async () => {
    const { db, membershipUpdate, prisma, tx } = harness();

    await transferSpaceOwnership(db, prisma, input);

    expect(tx.space.updateMany).toHaveBeenCalledWith({
      where: { id: 'space-id', version: 1, ownerUserId: 'owner-user' },
      data: { ownerUserId: 'target-user', version: { increment: 1 } },
    });
    expect(membershipUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'owner-membership' },
      data: { roleId: 'demotion-role', version: { increment: 1 } },
    });
    expect(membershipUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'target-membership' },
      data: { roleId: 'owner-role', version: { increment: 1 } },
    });
  });

  it.each([
    [{ targetStatus: 'DISABLED' }, 'active account'],
    [{ target: { id: 'owner-membership', userId: 'owner-user' } }, 'another member'],
    [{ demotionCandidate: null }, 'No active role'],
    [{ claimCount: 0 }, 'ownership has changed'],
  ])('rejects an invalid ownership transfer %#', async (overrides, message) => {
    const { db, prisma } = harness(overrides);

    await expect(transferSpaceOwnership(db, prisma, input)).rejects.toThrow(message);
  });

  it('refuses Default Space transfer before it can create or update a membership', async () => {
    const { db, prisma, tx } = harness({ space: { isDefault: true } });

    await expect(transferSpaceOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.spaceMembership.findFirst).not.toHaveBeenCalled();
    expect(tx.spaceMembership.update).not.toHaveBeenCalled();
  });
});
