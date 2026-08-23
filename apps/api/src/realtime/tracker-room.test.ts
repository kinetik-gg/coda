import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedTrackerMemberIds, canJoinTrackerRoom, trackerRoom } from './tracker-room';

const { resolveActiveMembershipMock } = vi.hoisted(() => ({
  resolveActiveMembershipMock: vi.fn(),
}));

vi.mock('../spaces/space-resources.service', () => ({
  // The production class is instantiated without a request auth context inside these helpers;
  // replacing it wholesale lets each test script what a Space lookup would have resolved.
  SpaceResourcesService: class {
    resolveActiveMembership = resolveActiveMembershipMock;
  },
}));

beforeEach(() => {
  resolveActiveMembershipMock.mockReset();
});

function accessPrisma(
  membership: object | null,
  tracker: object | null = { deletedAt: null },
): object {
  return {
    trackerMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
    tracker: { findUnique: vi.fn().mockResolvedValue(tracker) },
  };
}

describe('tracker room access', () => {
  it('names rooms after the tracker id', () => {
    expect(trackerRoom('t1')).toBe('tracker:t1');
  });

  it.each([
    ['direct member', { role: { archivedAt: null } }, null],
    ['space-tier member', null, { role: { resourceTier: 'viewer' }, space: { deletedAt: null } }],
  ])('admits a %s', async (_label, membership, spaceMembership) => {
    resolveActiveMembershipMock.mockResolvedValue(spaceMembership);

    await expect(canJoinTrackerRoom(accessPrisma(membership) as never, 'u1', 't1')).resolves.toBe(
      true,
    );
  });

  it('does not consult Spaces once a direct membership stands', async () => {
    await expect(
      canJoinTrackerRoom(accessPrisma({ role: { archivedAt: null } }) as never, 'u1', 't1'),
    ).resolves.toBe(true);
    expect(resolveActiveMembershipMock).not.toHaveBeenCalled();
  });

  it.each([
    ['trashed', { deletedAt: new Date() }],
    ['missing', null],
  ])('refuses a %s tracker even for a direct member', async (_label, tracker) => {
    await expect(
      canJoinTrackerRoom(
        accessPrisma({ role: { archivedAt: null } }, tracker) as never,
        'u1',
        't1',
      ),
    ).resolves.toBe(false);
    expect(resolveActiveMembershipMock).not.toHaveBeenCalled();
  });

  it('refuses an archived-role member whose Space reach is absent', async () => {
    resolveActiveMembershipMock.mockResolvedValue(null);

    await expect(
      canJoinTrackerRoom(accessPrisma({ role: { archivedAt: new Date() } }) as never, 'u1', 't1'),
    ).resolves.toBe(false);
  });

  it('collects direct members first and projects the remainder through Space tiers', async () => {
    const prisma = {
      trackerMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'direct-1' }, { userId: 'direct-2' }]),
      },
    };
    resolveActiveMembershipMock.mockImplementation((userId: string) =>
      userId === 'spacer'
        ? Promise.resolve({ role: { resourceTier: 'viewer' } })
        : Promise.resolve(null),
    );

    const authorized = await authorizedTrackerMemberIds(prisma as never, 't1', [
      'direct-1',
      'direct-2',
      'spacer',
      'outsider',
    ]);

    expect(authorized).toEqual(new Set(['direct-1', 'direct-2', 'spacer']));
    // Only users without a direct grant are projected through Spaces.
    expect(resolveActiveMembershipMock).toHaveBeenCalledTimes(2);
    for (const call of resolveActiveMembershipMock.mock.calls) {
      expect(call[0]).not.toMatch(/^direct-/);
      expect(call[1]).toBe('tracker');
      expect(call[2]).toBe('t1');
    }
  });

  it('returns an empty set without querying when nobody is connected', async () => {
    const prisma = {
      trackerMembership: { findMany: vi.fn() },
    };

    const authorized = await authorizedTrackerMemberIds(prisma as never, 't1', []);

    expect(authorized).toEqual(new Set());
    expect(prisma.trackerMembership.findMany).not.toHaveBeenCalled();
  });
});
