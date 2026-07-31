import { describe, expect, it, vi } from 'vitest';
import { resolveDefaultSpaceAuthority } from './default-space-authority';
import { DEFAULT_SPACE_ID } from './space-constants';

const administrator = 'the-administrator';

const defaultSpace = {
  id: DEFAULT_SPACE_ID,
  name: 'Default',
  ownerUserId: null as string | null,
  isDefault: true,
  version: 1,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
};

const ownerRole = {
  id: 'default-owner-role',
  spaceId: DEFAULT_SPACE_ID,
  isOwner: true,
  archivedAt: null,
  permissions: [{ permission: 'manage_space_settings' }, { permission: 'read_space' }],
};

function prismaWith({
  space = defaultSpace,
  instanceOwnerUserId = administrator,
  role = ownerRole,
}: {
  space?: object | null;
  instanceOwnerUserId?: string | null;
  role?: object | null;
} = {}) {
  return {
    space: { findFirst: vi.fn().mockResolvedValue(space) },
    instanceSettings: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          instanceOwnerUserId === null ? null : { ownerUserId: instanceOwnerUserId },
        ),
    },
    spaceRole: { findFirst: vi.fn().mockResolvedValue(role) },
  };
}

describe('resolveDefaultSpaceAuthority', () => {
  // The state of literally every instance on day one: the Spaces migration ran before anyone had
  // signed up, so `spaces.owner_user_id` is NULL and the instance administrator is the only thing
  // that identifies anybody. Resolving through `spaces.owner_user_id` alone would still leave the
  // Default Space ungoverned on a fresh install (#334).
  it('recognises the instance administrator when the Default Space has no recorded owner', async () => {
    const prisma = prismaWith();

    const authority = await resolveDefaultSpaceAuthority(prisma as never, administrator);

    expect(authority).toMatchObject({
      id: null,
      spaceId: DEFAULT_SPACE_ID,
      userId: administrator,
      roleId: ownerRole.id,
    });
    expect(authority?.role.permissions).toEqual(ownerRole.permissions);
    expect(prisma.space.findFirst).toHaveBeenCalledWith({
      where: { id: DEFAULT_SPACE_ID, deletedAt: null },
    });
  });

  // On an upgrade the migration copied `instance_settings.owner_user_id` into the Space row, so
  // the two agree; this pins that the Space's own owner column is honoured on its own terms.
  it('recognises the Default Space owner recorded by the upgrade', async () => {
    const prisma = prismaWith({
      space: { ...defaultSpace, ownerUserId: 'upgraded-owner' },
      instanceOwnerUserId: null,
    });

    await expect(
      resolveDefaultSpaceAuthority(prisma as never, 'upgraded-owner'),
    ).resolves.toMatchObject({ userId: 'upgraded-owner' });
  });

  it('gives an ordinary user no standing, without reading the owner role', async () => {
    const prisma = prismaWith();

    await expect(resolveDefaultSpaceAuthority(prisma as never, 'someone-else')).resolves.toBeNull();
    expect(prisma.spaceRole.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['the Default Space is absent', { space: null }],
    ['its owner role is missing', { role: null }],
  ])('withholds standing when %s', async (_case, overrides) => {
    await expect(
      resolveDefaultSpaceAuthority(prismaWith(overrides) as never, administrator),
    ).resolves.toBeNull();
  });
});
