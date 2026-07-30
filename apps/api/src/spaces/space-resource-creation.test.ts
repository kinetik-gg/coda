import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from './space-constants';
import { placeResourceInSpace, SpaceResourceCreationService } from './space-resource-creation';

const SPACE_ID = '00000000-0000-4000-8000-000000000003';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000101';

function harness(assert = vi.fn().mockResolvedValue({ id: 'space-membership' })) {
  const permissions = { assert };
  return { service: new SpaceResourceCreationService(permissions as never), permissions };
}

function writer(lastPosition?: string) {
  return {
    spaceResource: {
      findFirst: vi.fn().mockResolvedValue(lastPosition ? { position: lastPosition } : null),
      create: vi.fn().mockResolvedValue({ id: 'mapping' }),
    },
  };
}

describe('SpaceResourceCreationService', () => {
  it('asserts create_resources against the Space a request names', async () => {
    const { service, permissions } = harness();

    await expect(service.authorizeTarget('user', SPACE_ID)).resolves.toBe(SPACE_ID);

    expect(permissions.assert).toHaveBeenCalledWith('user', SPACE_ID, 'create_resources');
  });

  it('propagates the refusal when the named Space withholds create_resources', async () => {
    const { service } = harness(
      vi.fn().mockRejectedValue(new ForbiddenException('Missing permission: create_resources')),
    );

    await expect(service.authorizeTarget('user', SPACE_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires no Space grant when a request names no Space', async () => {
    const { service, permissions } = harness();

    await expect(service.authorizeTarget('user')).resolves.toBe(DEFAULT_SPACE_ID);

    expect(permissions.assert).not.toHaveBeenCalled();
  });

  it('requires no Space grant when a request names the Default Space explicitly', async () => {
    const { service, permissions } = harness();

    await expect(service.authorizeTarget('user', DEFAULT_SPACE_ID)).resolves.toBe(DEFAULT_SPACE_ID);

    expect(permissions.assert).not.toHaveBeenCalled();
  });
});

describe('placeResourceInSpace', () => {
  it('writes no mapping row for the Default Space', async () => {
    const prisma = writer();

    await placeResourceInSpace(prisma as never, 'screenplay', RESOURCE_ID, DEFAULT_SPACE_ID);

    expect(prisma.spaceResource.create).not.toHaveBeenCalled();
    expect(prisma.spaceResource.findFirst).not.toHaveBeenCalled();
  });

  it('appends the new resource after the last mapping in a named Space', async () => {
    const prisma = writer('8000000000000000');

    await placeResourceInSpace(prisma as never, 'breakdown', RESOURCE_ID, SPACE_ID);

    const call = prisma.spaceResource.create.mock.calls[0]?.[0] as {
      data: { spaceId: string; resourceType: string; resourceId: string; position: string };
    };
    expect(call.data.spaceId).toBe(SPACE_ID);
    expect(call.data.resourceType).toBe('breakdown');
    expect(call.data.resourceId).toBe(RESOURCE_ID);
    expect(call.data.position > '8000000000000000').toBe(true);
  });

  it('positions the first resource in a Space after the padded positions the reconciler writes', async () => {
    const prisma = writer();

    await placeResourceInSpace(prisma as never, 'screenplay', RESOURCE_ID, SPACE_ID);

    const call = prisma.spaceResource.create.mock.calls[0]?.[0] as {
      data: { position: string };
    };
    expect(call.data.position > '00000001').toBe(true);
    expect(call.data.position).toHaveLength(16);
  });
});
