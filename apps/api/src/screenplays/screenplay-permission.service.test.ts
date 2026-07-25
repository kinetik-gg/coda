import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayPermissionService } from './screenplay-permission.service';

function permissionService(membership: object, credential: unknown = null) {
  const prisma = {
    screenplayMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
  };
  const authContext = { credential: vi.fn().mockReturnValue(credential) };
  return new ScreenplayPermissionService(prisma as never, authContext as never);
}

describe('ScreenplayPermissionService', () => {
  it('resolves a member and honours an active role permission', async () => {
    const membership = {
      id: 'membership',
      role: { archivedAt: null, permissions: [{ permission: 'read_screenplay' }] },
      screenplay: { ownerUserId: 'owner' },
    };
    const service = permissionService(membership);

    await expect(service.assert('user', 'screenplay', 'read_screenplay')).resolves.toBe(membership);
  });

  it('hides the screenplay from a non-member (404, not 403)', async () => {
    const service = permissionService(null as never);

    await expect(service.assert('user', 'screenplay', 'read_screenplay')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not honour permissions inherited from an archived role', async () => {
    const service = permissionService({
      role: { archivedAt: new Date(), permissions: [{ permission: 'read_screenplay' }] },
      screenplay: { ownerUserId: 'owner' },
    });

    await expect(service.assert('user', 'screenplay', 'read_screenplay')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 403 when a member lacks the requested permission', async () => {
    const service = permissionService({
      id: 'membership',
      role: { archivedAt: null, permissions: [{ permission: 'read_screenplay' }] },
      screenplay: { ownerUserId: 'owner' },
    });

    await expect(service.assert('user', 'screenplay', 'edit_screenplay')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses API-credential requests until screenplay credential scoping ships', async () => {
    const service = permissionService(
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
  });
});
