import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayPermissionService } from './screenplay-permission.service';

function permissionService(
  membership: object | null,
  credential: unknown = null,
  spaceMembership: object | null = null,
) {
  const prisma = {
    screenplayMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
  };
  const authContext = { credential: vi.fn().mockReturnValue(credential) };
  const spaceResources = {
    resolveActiveMembership: vi.fn().mockResolvedValue(spaceMembership),
  };
  return {
    service: new ScreenplayPermissionService(
      prisma as never,
      authContext as never,
      spaceResources as never,
    ),
    spaceResources,
  };
}

describe('ScreenplayPermissionService', () => {
  it('resolves a member and honours an active role permission', async () => {
    const membership = {
      id: 'membership',
      role: { archivedAt: null, permissions: [{ permission: 'read_screenplay' }] },
      screenplay: { ownerUserId: 'owner' },
    };
    const { service, spaceResources } = permissionService(membership);

    await expect(service.assert('user', 'screenplay', 'read_screenplay')).resolves.toBe(membership);
    expect(spaceResources.resolveActiveMembership).not.toHaveBeenCalled();
  });

  it('hides the screenplay from a non-member (404, not 403)', async () => {
    const { service } = permissionService(null);

    await expect(service.assert('user', 'screenplay', 'read_screenplay')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not honour permissions inherited from an archived role', async () => {
    const { service } = permissionService({
      role: { archivedAt: new Date(), permissions: [{ permission: 'read_screenplay' }] },
      screenplay: { ownerUserId: 'owner' },
    });

    await expect(service.assert('user', 'screenplay', 'read_screenplay')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 403 when a member lacks the requested permission', async () => {
    const { service } = permissionService({
      id: 'membership',
      role: { archivedAt: null, permissions: [{ permission: 'read_screenplay' }] },
      screenplay: { ownerUserId: 'owner' },
    });

    await expect(service.assert('user', 'screenplay', 'edit_screenplay')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses API-credential requests until screenplay credential scoping ships', async () => {
    const { service, spaceResources } = permissionService(
      {
        id: 'membership',
        role: { archivedAt: null, permissions: [{ permission: 'read_screenplay' }] },
        screenplay: { ownerUserId: 'owner' },
      },
      { id: 'credential', projectId: 'project', userId: 'user', kind: 'API_KEY', permissions: [] },
    );

    await expect(service.membership('user', 'screenplay')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(spaceResources.resolveActiveMembership).not.toHaveBeenCalled();
  });

  it('projects a Space-only member tier onto screenplay permissions', async () => {
    const { service } = permissionService(null, null, {
      id: 'space-membership',
      roleId: 'space-role',
      role: { resourceTier: 'contributor' },
    });

    const membership = await service.assert('user', 'screenplay', 'edit_screenplay');

    expect(membership).toMatchObject({
      id: 'space-membership',
      screenplayId: 'screenplay',
      role: { isOwner: false },
    });
    expect(membership.role.permissions.map((entry) => entry.permission)).toContain(
      'edit_screenplay',
    );
  });

  it('returns 403 when Space reach exists but its tier lacks the permission', async () => {
    const { service } = permissionService(null, null, {
      id: 'space-membership',
      roleId: 'space-role',
      role: { resourceTier: 'viewer' },
    });

    await expect(service.assert('user', 'screenplay', 'edit_screenplay')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each(['invite_members', 'manage_roles', 'manage_member_roles'] as const)(
    'never projects %s from a Space tier',
    async (permission) => {
      const { service } = permissionService(null, null, {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'manager' },
      });

      await expect(service.assert('user', 'screenplay', permission)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('falls back from an archived direct role to active Space reach', async () => {
    const { service } = permissionService(
      {
        role: { archivedAt: new Date(), permissions: [{ permission: 'read_screenplay' }] },
      },
      null,
      {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'viewer' },
      },
    );

    await expect(service.assert('user', 'screenplay', 'read_screenplay')).resolves.toMatchObject({
      id: 'space-membership',
    });
  });
});
