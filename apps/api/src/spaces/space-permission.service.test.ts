import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SpacePermissionService } from './space-permission.service';

function permissionService(membership: object, credential: unknown = null) {
  const prisma = { spaceMembership: { findUnique: vi.fn().mockResolvedValue(membership) } };
  const authContext = { credential: vi.fn().mockReturnValue(credential) };
  return new SpacePermissionService(prisma as never, authContext as never);
}

describe('SpacePermissionService', () => {
  it('honours an active member permission', async () => {
    const membership = {
      id: 'membership',
      space: { deletedAt: null },
      role: { archivedAt: null, permissions: [{ permission: 'read_space' }] },
    };
    const service = permissionService(membership);

    await expect(service.assert('user', 'space', 'read_space')).resolves.toBe(membership);
  });

  it.each([
    [null],
    [{ space: { deletedAt: new Date() }, role: { archivedAt: null, permissions: [] } }],
    [{ space: { deletedAt: null }, role: { archivedAt: new Date(), permissions: [] } }],
  ])('hides a non-member or inactive membership with 404', async (membership) => {
    await expect(
      permissionService(membership as never).assert('user', 'space', 'read_space'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 403 only after resolving an active member', async () => {
    const service = permissionService({
      space: { deletedAt: null },
      role: { archivedAt: null, permissions: [{ permission: 'read_space' }] },
    });

    await expect(service.assert('user', 'space', 'delete_space')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('treats project-scoped credentials as non-members', async () => {
    const service = permissionService(
      { space: { deletedAt: null }, role: { archivedAt: null, permissions: [] } },
      { id: 'credential', projectId: 'project' },
    );

    await expect(service.membership('user', 'space')).rejects.toBeInstanceOf(NotFoundException);
    expect(() => service.assertSession()).toThrow(NotFoundException);
  });
});
