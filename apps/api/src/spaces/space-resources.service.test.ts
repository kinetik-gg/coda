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
});
