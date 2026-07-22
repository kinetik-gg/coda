import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionService } from './permission.service';

function permissionService(membership: object) {
  const prisma = {
    projectMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
  };
  const authContext = { credential: vi.fn().mockReturnValue(null) };
  return new PermissionService(prisma as never, authContext as never);
}

describe('PermissionService role lifecycle', () => {
  it('does not honor permissions inherited from an archived role', async () => {
    const service = permissionService({
      project: { deletedAt: null },
      role: {
        archivedAt: new Date(),
        permissions: [{ permission: 'read_project' }],
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
    const service = permissionService(membership);

    await expect(service.assert('user', 'project', 'read_project')).resolves.toBe(membership);
  });
});
