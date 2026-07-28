import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from './space-constants';
import { SpaceResourcesService } from './space-resources.service';

describe('SpaceResourcesService', () => {
  it('returns the mapped Space when the join row exists', async () => {
    const findUnique = vi.fn().mockResolvedValue({ spaceId: 'mapped-space' });
    const service = new SpaceResourcesService({
      spaceResource: { findUnique },
    } as never);

    await expect(service.resolveSpaceId('screenplay', 'resource')).resolves.toBe('mapped-space');
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        resourceType_resourceId: { resourceType: 'screenplay', resourceId: 'resource' },
      },
      select: { spaceId: true },
    });
  });

  it('treats a missing mapping as the fixed Default Space', async () => {
    const service = new SpaceResourcesService({
      spaceResource: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.resolveSpaceId('breakdown', 'unmapped')).resolves.toBe(DEFAULT_SPACE_ID);
  });

  it('resolves an active membership through the resource mapping', async () => {
    const membership = {
      id: 'membership',
      role: { archivedAt: null, resourceTier: 'contributor' },
      space: { deletedAt: null },
    };
    const prisma = {
      spaceResource: { findUnique: vi.fn().mockResolvedValue({ spaceId: 'space' }) },
      spaceMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
    };
    const service = new SpaceResourcesService(prisma as never);

    await expect(service.resolveActiveMembership('user', 'breakdown', 'project')).resolves.toEqual(
      membership,
    );
    expect(prisma.spaceMembership.findUnique).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: 'space', userId: 'user' } },
      include: { role: true, space: true },
    });
  });

  it('does not infer membership from the Default Space owner column', async () => {
    const prisma = {
      spaceResource: { findUnique: vi.fn().mockResolvedValue(null) },
      spaceMembership: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new SpaceResourcesService(prisma as never);

    await expect(
      service.resolveActiveMembership('default-owner', 'screenplay', 'unmapped'),
    ).resolves.toBeNull();
    expect(prisma.spaceMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId_userId: { spaceId: DEFAULT_SPACE_ID, userId: 'default-owner' } },
      }),
    );
  });

  it.each([
    {
      role: { archivedAt: new Date(), resourceTier: 'viewer' },
      space: { deletedAt: null },
    },
    {
      role: { archivedAt: null, resourceTier: 'viewer' },
      space: { deletedAt: new Date() },
    },
    {
      role: { archivedAt: null, resourceTier: 'unexpected' },
      space: { deletedAt: null },
    },
  ])('rejects inactive or invalid Space reach', async ({ role, space }) => {
    const service = new SpaceResourcesService({
      spaceResource: { findUnique: vi.fn().mockResolvedValue({ spaceId: 'space' }) },
      spaceMembership: { findUnique: vi.fn().mockResolvedValue({ role, space }) },
    } as never);

    await expect(
      service.resolveActiveMembership('user', 'breakdown', 'project'),
    ).resolves.toBeNull();
  });

  it('preserves direct ids exactly when the user has no readable Space membership', async () => {
    const prisma = {
      spaceMembership: { findMany: vi.fn().mockResolvedValue([]) },
      spaceResource: { findMany: vi.fn() },
    };
    const service = new SpaceResourcesService(prisma as never);

    await expect(
      service.listAccessibleResourceIds('user', 'breakdown', ['direct-b', 'direct-a']),
    ).resolves.toEqual(['direct-b', 'direct-a']);
    expect(prisma.spaceResource.findMany).not.toHaveBeenCalled();
  });

  it('unions direct and Space-readable ids without duplicates', async () => {
    const service = new SpaceResourcesService({
      spaceMembership: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ spaceId: 'space', role: { resourceTier: 'contributor' } }]),
      },
      spaceResource: {
        findMany: vi.fn().mockResolvedValue([
          { resourceId: 'direct', spaceId: 'space' },
          { resourceId: 'space-only', spaceId: 'space' },
        ]),
      },
    } as never);

    await expect(
      service.listAccessibleResourceIds('user', 'screenplay', ['direct']),
    ).resolves.toEqual(['direct', 'space-only']);
  });

  it('filters the union and treats missing mappings as Default Space resources', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ resourceId: 'mapped-default', spaceId: DEFAULT_SPACE_ID }])
      .mockResolvedValueOnce([{ resourceId: 'mapped-default' }, { resourceId: 'direct-other' }])
      .mockResolvedValueOnce([
        { resourceId: 'mapped-default', spaceId: DEFAULT_SPACE_ID },
        { resourceId: 'direct-other', spaceId: 'other-space' },
      ]);
    const service = new SpaceResourcesService({
      spaceMembership: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ spaceId: DEFAULT_SPACE_ID, role: { resourceTier: 'viewer' } }]),
      },
      spaceResource: { findMany },
      project: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'mapped-default' },
            { id: 'unmapped-default' },
            { id: 'direct-other' },
          ]),
      },
    } as never);

    await expect(
      service.listAccessibleResourceIds('user', 'breakdown', ['direct-other'], DEFAULT_SPACE_ID),
    ).resolves.toEqual(['mapped-default', 'unmapped-default']);
  });
});
