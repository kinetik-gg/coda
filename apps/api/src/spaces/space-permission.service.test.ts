import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from './space-constants';
import { SpacePermissionService } from './space-permission.service';

const administrator = 'the-administrator';

function permissionService(membership: object, credential: unknown = null) {
  const prisma = { spaceMembership: { findUnique: vi.fn().mockResolvedValue(membership) } };
  const authContext = { credential: vi.fn().mockReturnValue(credential) };
  return new SpacePermissionService(prisma as never, authContext as never);
}

/**
 * The Default Space exactly as every instance carries it: present, owned by nobody in its own row
 * (a fresh install migrates before the first signup ever happens), and with **zero membership
 * rows** — `spaceMembership.findUnique` answers `null` for everyone, always.
 */
function freshInstancePrisma() {
  return {
    spaceMembership: { findUnique: vi.fn().mockResolvedValue(null) },
    space: {
      findFirst: vi.fn().mockResolvedValue({
        id: DEFAULT_SPACE_ID,
        ownerUserId: null,
        isDefault: true,
        version: 1,
        createdAt: new Date('2026-01-01'),
        deletedAt: null,
      }),
    },
    instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: administrator }) },
    spaceRole: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'default-owner-role',
        isOwner: true,
        permissions: [{ permission: 'manage_space_settings' }],
      }),
    },
  };
}

function serviceFor(prisma: object, credential: unknown = null) {
  return new SpacePermissionService(
    prisma as never,
    {
      credential: vi.fn().mockReturnValue(credential),
    } as never,
  );
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

// The exact shape of a brand-new instance — one Space, zero memberships — which is what every
// install looks like on day one and what made Space settings unreachable for everyone (#334).
describe('SpacePermissionService and the membership-less Default Space', () => {
  it('grants the instance administrator settings authority with no membership row', async () => {
    const prisma = freshInstancePrisma();

    const membership = await serviceFor(prisma).assert(
      administrator,
      DEFAULT_SPACE_ID,
      'manage_space_settings',
    );

    expect(prisma.spaceMembership.findUnique).toHaveBeenCalled();
    expect(membership.id).toBeNull();
    expect(membership.role.permissions).toEqual([{ permission: 'manage_space_settings' }]);
  });

  it('refuses an ordinary user with 403 rather than pretending Default is not there', async () => {
    await expect(
      serviceFor(freshInstancePrisma()).assert('someone-else', DEFAULT_SPACE_ID, 'read_space'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still answers 403 when the administrator lacks the requested permission', async () => {
    const prisma = freshInstancePrisma();

    await expect(
      serviceFor(prisma).assert(administrator, DEFAULT_SPACE_ID, 'delete_space'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('leaves every other Space on the 404 tenant-isolation path', async () => {
    const prisma = freshInstancePrisma();

    await expect(
      serviceFor(prisma).membership(administrator, 'some-other-space'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.space.findFirst).not.toHaveBeenCalled();
  });

  it('never extends the authority to a project-scoped credential', async () => {
    const prisma = freshInstancePrisma();

    await expect(
      serviceFor(prisma, { id: 'credential' }).membership(administrator, DEFAULT_SPACE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.space.findFirst).not.toHaveBeenCalled();
  });
});
