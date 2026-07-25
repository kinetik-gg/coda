import { describe, expect, it, vi } from 'vitest';
import { ScreenplayAccessController } from './screenplay-access.controller';

function request(userId = 'user-id') {
  return { user: { id: userId } } as never;
}

describe('ScreenplayAccessController', () => {
  it('returns the management view', async () => {
    const management = vi.fn().mockResolvedValue({ id: 'screenplay-id' });
    const controller = new ScreenplayAccessController({ management } as never);

    await expect(controller.management(request(), 'screenplay-id')).resolves.toEqual({
      data: { id: 'screenplay-id' },
    });
    expect(management).toHaveBeenCalledWith('user-id', 'screenplay-id');
  });

  it('shapes an invitation response with a relative accept URL and hidden token', async () => {
    const invite = vi.fn().mockResolvedValue({
      invitation: { id: 'invitation-id', expiresAt: new Date('2026-08-01T00:00:00.000Z') },
      token: 'raw-token-value',
    });
    const controller = new ScreenplayAccessController({ invite } as never);

    const result = await controller.invite(request(), 'screenplay-id', {
      email: 'invitee@example.test',
      roleId: '00000000-0000-4000-8000-000000000001',
    });

    expect(invite).toHaveBeenCalledWith(
      'user-id',
      'screenplay-id',
      'invitee@example.test',
      '00000000-0000-4000-8000-000000000001',
    );
    expect(result.data.id).toBe('invitation-id');
    expect(result.data.invitationUrl).toBe('/accept-invitation?token=raw-token-value');
  });

  it('lists available users', async () => {
    const availableUsers = vi.fn().mockResolvedValue([{ id: 'candidate' }]);
    const controller = new ScreenplayAccessController({ availableUsers } as never);

    await expect(controller.availableUsers(request(), 'screenplay-id')).resolves.toEqual({
      data: [{ id: 'candidate' }],
    });
  });

  it('adds a membership', async () => {
    const addMembership = vi.fn().mockResolvedValue({ id: 'membership' });
    const controller = new ScreenplayAccessController({ addMembership } as never);

    const result = await controller.addMembership(request(), 'screenplay-id', {
      userId: '00000000-0000-4000-8000-000000000002',
      roleId: '00000000-0000-4000-8000-000000000003',
    });

    expect(result).toEqual({ data: { id: 'membership' } });
    expect(addMembership).toHaveBeenCalledWith(
      'user-id',
      'screenplay-id',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    );
  });

  it('updates a membership role', async () => {
    const updateMembership = vi.fn().mockResolvedValue({ id: 'membership' });
    const controller = new ScreenplayAccessController({ updateMembership } as never);

    await controller.updateMembership(request(), 'screenplay-id', 'membership-id', {
      roleId: '00000000-0000-4000-8000-000000000004',
      version: 1,
    });

    expect(updateMembership).toHaveBeenCalledWith(
      'user-id',
      'screenplay-id',
      'membership-id',
      '00000000-0000-4000-8000-000000000004',
      1,
    );
  });

  it('removes a membership', async () => {
    const removeMembership = vi.fn().mockResolvedValue({ id: 'membership-id' });
    const controller = new ScreenplayAccessController({ removeMembership } as never);

    await controller.removeMembership(request(), 'screenplay-id', 'membership-id', { version: 2 });

    expect(removeMembership).toHaveBeenCalledWith('user-id', 'screenplay-id', 'membership-id', 2);
  });

  it('transfers ownership', async () => {
    const transferOwnership = vi.fn().mockResolvedValue({ id: 'screenplay-id', version: 2 });
    const controller = new ScreenplayAccessController({ transferOwnership } as never);

    const result = await controller.transfer(request(), 'screenplay-id', {
      newOwnerMembershipId: '00000000-0000-4000-8000-000000000005',
      version: 1,
    });

    expect(result).toEqual({ data: { id: 'screenplay-id', version: 2 } });
    expect(transferOwnership).toHaveBeenCalledWith(
      'user-id',
      'screenplay-id',
      '00000000-0000-4000-8000-000000000005',
      1,
    );
  });
});
