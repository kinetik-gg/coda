import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionService } from './permission.service';

function permissionService({
  directMembership = null,
  spaceMembership = null,
  credential = null,
}: {
  directMembership?: object | null;
  spaceMembership?: object | null;
  credential?: object | null;
}) {
  const prisma = {
    projectMembership: { findUnique: vi.fn().mockResolvedValue(directMembership) },
    project: {
      findUnique: vi.fn().mockResolvedValue({ ownerUserId: 'owner', deletedAt: null }),
    },
  };
  const authContext = { credential: vi.fn().mockReturnValue(credential) };
  const spaceResources = {
    resolveActiveMembership: vi.fn().mockResolvedValue(spaceMembership),
  };
  return {
    service: new PermissionService(prisma as never, authContext as never, spaceResources as never),
    spaceResources,
  };
}

describe('PermissionService role lifecycle', () => {
  it('does not honor permissions inherited from an archived role', async () => {
    const { service } = permissionService({
      directMembership: {
        project: { deletedAt: null },
        role: {
          archivedAt: new Date(),
          permissions: [{ permission: 'read_project' }],
        },
      },
    });

    await expect(service.assert('user', 'project', 'read_project')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('continues to honor an active role permission', async () => {
    const membership = {
      id: 'membership',
      project: { deletedAt: null },
      role: { archivedAt: null, permissions: [{ permission: 'read_project' }] },
    };
    const { service, spaceResources } = permissionService({ directMembership: membership });

    await expect(service.assert('user', 'project', 'read_project')).resolves.toBe(membership);
    expect(spaceResources.resolveActiveMembership).not.toHaveBeenCalled();
  });

  it('projects a Space-only member tier onto project permissions', async () => {
    const { service } = permissionService({
      spaceMembership: {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'contributor' },
      },
    });

    const membership = await service.assert('user', 'project', 'manage_items');

    expect(membership).toMatchObject({
      id: 'space-membership',
      projectId: 'project',
      role: { isOwner: false },
    });
    expect(membership.role.permissions.map((entry) => entry.permission)).toContain('manage_items');
  });

  it('returns 403 when Space reach is observable but the projected tier lacks permission', async () => {
    const { service } = permissionService({
      spaceMembership: {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'viewer' },
      },
    });

    await expect(service.assert('user', 'project', 'manage_items')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns 404 when neither resource nor Space membership grants reach', async () => {
    const { service } = permissionService({});

    await expect(service.assert('user', 'project', 'read_project')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('never projects resource administration permissions from a Space tier', async () => {
    const { service } = permissionService({
      spaceMembership: {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'manager' },
      },
    });

    await expect(service.assert('user', 'project', 'delete_project')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('keeps project credentials on their direct project graph', async () => {
    const { service, spaceResources } = permissionService({
      credential: {
        userId: 'user',
        projectId: 'project',
        permissions: ['read_project'],
      },
      spaceMembership: {
        id: 'space-membership',
        roleId: 'space-role',
        role: { resourceTier: 'manager' },
      },
    });

    await expect(service.assert('user', 'project', 'read_project')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(spaceResources.resolveActiveMembership).not.toHaveBeenCalled();
  });
});
