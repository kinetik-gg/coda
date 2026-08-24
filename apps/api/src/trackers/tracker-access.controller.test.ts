import { describe, expect, it, vi } from 'vitest';
import { TrackerAccessController } from './tracker-access.controller';

function request(userId = 'user-id') {
  return { user: { id: userId } } as never;
}

describe('TrackerAccessController', () => {
  it('returns the management view', async () => {
    const management = vi.fn().mockResolvedValue({ id: 'tracker-id' });
    const controller = new TrackerAccessController({ management } as never);

    await expect(controller.management(request(), 'tracker-id')).resolves.toEqual({
      data: { id: 'tracker-id' },
    });
    expect(management).toHaveBeenCalledWith('user-id', 'tracker-id');
  });

  it('shapes an invitation response with a relative accept URL and hidden token', async () => {
    const invite = vi.fn().mockResolvedValue({
      invitation: { id: 'invitation-id', expiresAt: new Date('2026-09-01T00:00:00.000Z') },
      token: 'raw-token-value',
    });
    const controller = new TrackerAccessController({ invite } as never);

    const result = await controller.invite(request(), 'tracker-id', {
      email: 'invitee@example.test',
      roleId: '00000000-0000-4000-8000-000000000001',
    });

    expect(invite).toHaveBeenCalledWith(
      'user-id',
      'tracker-id',
      'invitee@example.test',
      '00000000-0000-4000-8000-000000000001',
    );
    expect(result.data.id).toBe('invitation-id');
    expect(result.data.invitationUrl).toBe('/accept-invitation?token=raw-token-value');
  });

  it('revokes a pending invitation', async () => {
    const revokeInvitation = vi.fn().mockResolvedValue({ id: 'invitation-id' });
    const controller = new TrackerAccessController({ revokeInvitation } as never);

    await expect(
      controller.revokeInvitation(request(), 'tracker-id', 'invitation-id'),
    ).resolves.toEqual({ data: { id: 'invitation-id' } });
    expect(revokeInvitation).toHaveBeenCalledWith('user-id', 'tracker-id', 'invitation-id');
  });

  it('lists available users', async () => {
    const availableUsers = vi.fn().mockResolvedValue([{ id: 'candidate' }]);
    const controller = new TrackerAccessController({ availableUsers } as never);

    await expect(controller.availableUsers(request(), 'tracker-id')).resolves.toEqual({
      data: [{ id: 'candidate' }],
    });
  });

  it('adds and updates memberships with optimistic versions', async () => {
    const addMembership = vi.fn().mockResolvedValue({ id: 'membership' });
    const updateMembership = vi.fn().mockResolvedValue({ id: 'membership' });
    const removeMembership = vi.fn().mockResolvedValue({ id: 'membership' });
    const controller = new TrackerAccessController({
      addMembership,
      updateMembership,
      removeMembership,
    } as never);

    await controller.addMembership(request(), 'tracker-id', {
      userId: '00000000-0000-4000-8000-000000000002',
      roleId: '00000000-0000-4000-8000-000000000003',
    });
    await controller.updateMembership(request(), 'tracker-id', 'membership-id', {
      roleId: '00000000-0000-4000-8000-000000000004',
      version: 2,
    });
    await controller.removeMembership(request(), 'tracker-id', 'membership-id', { version: 3 });

    expect(addMembership).toHaveBeenCalledWith(
      'user-id',
      'tracker-id',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    );
    expect(updateMembership).toHaveBeenCalledWith(
      'user-id',
      'tracker-id',
      'membership-id',
      '00000000-0000-4000-8000-000000000004',
      2,
    );
    expect(removeMembership).toHaveBeenCalledWith('user-id', 'tracker-id', 'membership-id', 3);
  });

  it('creates, updates, and archives custom roles', async () => {
    const createRole = vi.fn().mockResolvedValue({ id: 'role' });
    const updateRole = vi.fn().mockResolvedValue({ id: 'role' });
    const archiveRole = vi.fn().mockResolvedValue({ id: 'role' });
    const controller = new TrackerAccessController({
      createRole,
      updateRole,
      archiveRole,
    } as never);

    await controller.createRole(request(), 'tracker-id', {
      name: 'reviewer',
      description: null,
      permissions: ['read_tracker'],
    });
    await controller.updateRole(request(), 'tracker-id', 'role-id', {
      name: 'reviewer2',
      version: 1,
    });
    await controller.archiveRole(request(), 'tracker-id', 'role-id', { version: 4 });

    expect(createRole).toHaveBeenCalledWith('user-id', 'tracker-id', {
      name: 'reviewer',
      description: null,
      permissions: ['read_tracker'],
    });
    expect(updateRole).toHaveBeenCalledWith('user-id', 'tracker-id', 'role-id', {
      name: 'reviewer2',
      version: 1,
    });
    expect(archiveRole).toHaveBeenCalledWith('user-id', 'tracker-id', 'role-id', 4);
  });

  it('routes ownership transfer by membership id and version', async () => {
    const transferOwnership = vi.fn().mockResolvedValue({ id: 'tracker-id', version: 2 });
    const controller = new TrackerAccessController({ transferOwnership } as never);

    await controller.transfer(request(), 'tracker-id', {
      newOwnerMembershipId: '00000000-0000-4000-8000-000000000005',
      version: 1,
    });

    expect(transferOwnership).toHaveBeenCalledWith(
      'user-id',
      'tracker-id',
      '00000000-0000-4000-8000-000000000005',
      1,
    );
  });
});
