import { describe, expect, it, vi } from 'vitest';
import { allSpacePermissions } from '@coda/contracts';
import { defaultSpaceRoles, provisionSpaceAccess } from './space-roles';

describe('Space role provisioning', () => {
  it('defines owner, manager, contributor, and viewer tiers', () => {
    expect(defaultSpaceRoles.map((role) => [role.name, role.resourceTier])).toEqual([
      ['owner', 'manager'],
      ['manager', 'manager'],
      ['contributor', 'contributor'],
      ['viewer', 'viewer'],
    ]);
    expect(defaultSpaceRoles[0]?.permissions).toEqual(allSpacePermissions);
  });

  it('creates default roles and exactly one creator owner membership', async () => {
    let roleIndex = 0;
    const tx = {
      spaceRole: { create: vi.fn().mockImplementation(() => ({ id: `role-${roleIndex++}` })) },
      spaceMembership: { create: vi.fn().mockResolvedValue({ id: 'membership' }) },
    };

    await provisionSpaceAccess(tx as never, 'space', 'creator');

    expect(tx.spaceRole.create).toHaveBeenCalledTimes(4);
    expect(tx.spaceMembership.create).toHaveBeenCalledOnce();
    expect(tx.spaceMembership.create).toHaveBeenCalledWith({
      data: { spaceId: 'space', userId: 'creator', roleId: 'role-0' },
    });
  });
});
