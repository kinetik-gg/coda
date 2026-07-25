import { describe, expect, it, vi } from 'vitest';
import { defaultScreenplayRoles, provisionScreenplayAccess } from './screenplay-roles';

describe('defaultScreenplayRoles', () => {
  it('seeds exactly one owner role granting every permission', () => {
    const owners = defaultScreenplayRoles.filter((role) => role.isOwner);
    expect(owners).toHaveLength(1);
    expect(owners[0]!.name).toBe('owner');
    expect(owners[0]!.permissions).toContain('manage_screenplay_settings');
  });

  it('grants the viewer read-only and the editor read+edit', () => {
    const viewer = defaultScreenplayRoles.find((role) => role.name === 'viewer');
    const editor = defaultScreenplayRoles.find((role) => role.name === 'editor');
    expect(viewer!.permissions).toEqual(['read_screenplay']);
    expect(editor!.permissions).toEqual(['read_screenplay', 'edit_screenplay']);
  });
});

describe('provisionScreenplayAccess', () => {
  it('creates every seeded role and an owner-role membership for the creator', async () => {
    const createdRoles: Array<{ name: string; isOwner: boolean; id: string }> = [];
    const roleCreate = vi.fn(({ data }: { data: { name: string; isOwner: boolean } }) => {
      const role = { ...data, id: `role-${data.name}` };
      createdRoles.push(role);
      return Promise.resolve(role);
    });
    const membershipCreate = vi.fn().mockResolvedValue({ id: 'membership' });
    const tx = {
      screenplayRole: { create: roleCreate },
      screenplayMembership: { create: membershipCreate },
    };

    await provisionScreenplayAccess(tx as never, 'screenplay-id', 'owner-id');

    expect(roleCreate).toHaveBeenCalledTimes(defaultScreenplayRoles.length);
    expect(membershipCreate).toHaveBeenCalledWith({
      data: { screenplayId: 'screenplay-id', userId: 'owner-id', roleId: 'role-owner' },
    });
  });
});
