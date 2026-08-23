import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TrackerPermissionService } from './tracker-permission.service';

function permissionService(
  membership: object | null,
  credential: unknown = null,
  spaceMembership: object | null = null,
  tracker: object | null = { id: 'tracker' },
) {
  const prisma = {
    trackerMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
    tracker: { findUnique: vi.fn().mockResolvedValue(tracker) },
  };
  const authContext = { credential: vi.fn().mockReturnValue(credential) };
  const spaceResources = {
    resolveActiveMembership: vi.fn().mockResolvedValue(spaceMembership),
  };
  return {
    service: new TrackerPermissionService(
      prisma as never,
      authContext as never,
      spaceResources as never,
    ),
    spaceResources,
  };
}

describe('TrackerPermissionService', () => {
  it('resolves a member and honours an active role permission', async () => {
    const membership = {
      id: 'membership',
      role: { archivedAt: null, permissions: [{ permission: 'read_tracker' }] },
    };
    const { service, spaceResources } = permissionService(membership);

    await expect(service.assert('user', 'tracker', 'read_tracker')).resolves.toBe(membership);
    expect(spaceResources.resolveActiveMembership).not.toHaveBeenCalled();
  });

  it('hides the tracker from a non-member (404, not 403)', async () => {
    const { service } = permissionService(null);

    await expect(service.assert('user', 'tracker', 'read_tracker')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not honour permissions inherited from an archived role', async () => {
    const { service } = permissionService({
      role: { archivedAt: new Date(), permissions: [{ permission: 'read_tracker' }] },
    });

    await expect(service.assert('user', 'tracker', 'read_tracker')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 403 when a member lacks the requested permission', async () => {
    const { service } = permissionService({
      id: 'membership',
      role: { archivedAt: null, permissions: [{ permission: 'read_tracker' }] },
    });

    await expect(service.assert('user', 'tracker', 'edit_tracker_records')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses API-credential requests until tracker credential scoping ships', async () => {
    const { service, spaceResources } = permissionService(
      {
        id: 'membership',
        role: { archivedAt: null, permissions: [{ permission: 'read_tracker' }] },
      },
      { id: 'credential', projectId: 'project', userId: 'user', kind: 'API_KEY', permissions: [] },
    );

    await expect(service.membership('user', 'tracker')).rejects.toBeInstanceOf(NotFoundException);
    expect(spaceResources.resolveActiveMembership).not.toHaveBeenCalled();
  });

  it('projects a Space-only member tier onto tracker permissions', async () => {
    const { service } = permissionService(null, null, {
      id: 'space-membership',
      roleId: 'space-role',
      role: { resourceTier: 'contributor' },
    });

    const membership = await service.assert('user', 'tracker', 'edit_tracker_records');

    expect(membership).toMatchObject({
      id: 'space-membership',
      trackerId: 'tracker',
      role: { isOwner: false },
    });
    expect(membership.role.permissions.map((entry) => entry.permission)).toContain(
      'edit_tracker_records',
    );
  });

  it('projects comment_tracker from a viewer Space tier even though roles cannot hold it', async () => {
    const { service } = permissionService(null, null, {
      id: 'space-membership',
      roleId: 'space-role',
      role: { resourceTier: 'viewer' },
    });

    const membership = await service.assert('user', 'tracker', 'read_tracker');

    expect(membership.role.permissions.map((entry) => entry.permission)).toEqual([
      'read_tracker',
      'comment_tracker',
    ]);
  });

  it('returns 403 when Space reach exists but its tier lacks the permission', async () => {
    const { service } = permissionService(null, null, {
      id: 'space-membership',
      roleId: 'space-role',
      role: { resourceTier: 'viewer' },
    });

    await expect(
      service.assert('user', 'tracker', 'manage_tracker_settings'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never projects deletion-class authority from a Space tier', async () => {
    // `manage_tracker_settings` is the strongest tier grant; a manager Space tier may carry it,
    // but the DELETE route additionally requires a direct membership (see TrackersService.remove),
    // which this assertion pins at the choke point by returning the projected membership with
    // `isOwner: false`.
    const { service } = permissionService(null, null, {
      id: 'space-membership',
      roleId: 'space-role',
      role: { resourceTier: 'manager' },
    });

    const membership = await service.assert('user', 'tracker', 'manage_tracker_settings');
    expect(membership.role.isOwner).toBe(false);
  });

  it('falls back from an archived direct role to active Space reach', async () => {
    const { service } = permissionService(
      {
        role: { archivedAt: new Date(), permissions: [{ permission: 'read_tracker' }] },
      },
      null,
      {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'viewer' },
      },
    );

    await expect(service.assert('user', 'tracker', 'read_tracker')).resolves.toMatchObject({
      id: 'space-membership',
    });
  });

  it('does not synthesize Space reach for a nonexistent tracker', async () => {
    const { service } = permissionService(
      null,
      null,
      {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'manager' },
      },
      null,
    );

    await expect(service.membership('user', 'missing-tracker')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s a Space-projected member on a trashed tracker', async () => {
    const { service } = permissionService(
      null,
      null,
      {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'manager' },
      },
      { id: 'tracker', deletedAt: new Date() },
    );

    await expect(
      service.assert('user', 'tracker', 'manage_tracker_settings'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a direct member on a trashed tracker', async () => {
    const { service } = permissionService(
      {
        id: 'membership',
        role: { archivedAt: null, permissions: [{ permission: 'read_tracker' }] },
      },
      null,
      null,
      { id: 'tracker', deletedAt: new Date() },
    );

    await expect(service.assert('user', 'tracker', 'read_tracker')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('assertCommenter', () => {
    const matrix: Array<{
      name: string;
      permissions: string[];
      allowed: boolean;
    }> = [
      { name: 'direct owner (all role permissions)', permissions: ['read_tracker', 'edit_tracker_records', 'manage_tracker_fields', 'manage_tracker_settings'], allowed: true },
      { name: 'direct editor', permissions: ['read_tracker', 'edit_tracker_records', 'manage_tracker_fields'], allowed: true },
      { name: 'direct viewer (read-only)', permissions: ['read_tracker'], allowed: false },
    ];

    for (const entry of matrix) {
      it(`handles ${entry.name}`, async () => {
        const { service } = permissionService({
          id: 'membership',
          role: { archivedAt: null, permissions: entry.permissions.map((permission) => ({ permission })) },
        });

        const result = service.assertCommenter('user', 'tracker');
        if (entry.allowed) {
          await expect(result).resolves.toMatchObject({ id: 'membership' });
        } else {
          await expect(result).rejects.toBeInstanceOf(ForbiddenException);
        }
      });
    }

    it('lets a viewer-tier Space member comment through the projected comment_tracker grant', async () => {
      const { service } = permissionService(null, null, {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'viewer' },
      });

      await expect(service.assertCommenter('user', 'tracker')).resolves.toMatchObject({
        id: 'space-membership',
        role: { isOwner: false },
      });
    });

    it('hides the tracker from a non-member before any comment check', async () => {
      const { service } = permissionService(null);

      await expect(service.assertCommenter('user', 'tracker')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does not let an archived direct role comment through a stale membership row', async () => {
      const { service } = permissionService({
        role: {
          archivedAt: new Date(),
          permissions: [{ permission: 'edit_tracker_records' }],
        },
      });

      await expect(service.assertCommenter('user', 'tracker')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('directManagementMembership', () => {
    it('resolves a direct member even when the tracker is soft-deleted', async () => {
      const membership = {
        id: 'membership',
        role: { archivedAt: null, permissions: [{ permission: 'manage_tracker_settings' }] },
      };
      const { service } = permissionService(membership, null, null, {
        id: 'tracker',
        deletedAt: new Date(),
      });

      await expect(service.directManagementMembership('user', 'tracker')).resolves.toBe(membership);
    });

    it('404s a non-member', async () => {
      const { service } = permissionService(null);

      await expect(service.directManagementMembership('user', 'tracker')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s an archived role', async () => {
      const { service } = permissionService({
        role: { archivedAt: new Date(), permissions: [] },
      });

      await expect(service.directManagementMembership('user', 'tracker')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('ignores Space-tier reach entirely', async () => {
      const { service, spaceResources } = permissionService(null, null, {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'manager' },
      });

      await expect(service.directManagementMembership('user', 'tracker')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(spaceResources.resolveActiveMembership).not.toHaveBeenCalled();
    });

    it('404s an API-credential request', async () => {
      const { service } = permissionService(
        { id: 'membership', role: { archivedAt: null, permissions: [] } },
        {
          id: 'credential',
          projectId: 'project',
          userId: 'user',
          kind: 'API_KEY',
          permissions: [],
        },
      );

      await expect(service.directManagementMembership('user', 'tracker')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
