import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { transferScreenplayOwnership } from './screenplay-ownership';

interface Overrides {
  screenplay?: object | null;
  target?: object | null;
  targetStatus?: string;
  demotionCandidate?: object | null;
  claimCount?: number;
}

function harness(overrides: Overrides = {}) {
  const membershipUpdate = vi.fn().mockResolvedValue({});
  const tx = {
    screenplay: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides.screenplay === undefined
            ? { id: 'screenplay-id', version: 1 }
            : overrides.screenplay,
        ),
      updateMany: vi.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'screenplay-id', version: 2 }),
    },
    screenplayMembership: {
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
    screenplayRole: {
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
  screenplayId: 'screenplay-id',
  membershipId: 'target-membership',
  actorMembershipId: 'actor-membership',
  version: 1,
};

describe('transferScreenplayOwnership', () => {
  it('promotes the target and demotes the previous owner without moving ownerUserId', async () => {
    const { db, prisma, tx, membershipUpdate } = harness();

    await transferScreenplayOwnership(db, prisma, input);

    // The claim never touches owner_user_id (immutable storage-partition key).
    expect(tx.screenplay.updateMany).toHaveBeenCalledWith({
      where: { id: 'screenplay-id', version: 1 },
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

    await expect(transferScreenplayOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a self-transfer', async () => {
    const { db, prisma } = harness({
      target: { id: 'actor-membership', userId: 'owner-user' },
    });

    await expect(transferScreenplayOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses when no active role is available to demote the previous owner into', async () => {
    const { db, prisma } = harness({ demotionCandidate: null });

    await expect(transferScreenplayOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reports a concurrent version change as a conflict', async () => {
    const { db, prisma } = harness({ claimCount: 0 });

    await expect(transferScreenplayOwnership(db, prisma, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
