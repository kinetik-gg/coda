import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from './space-constants';
import { SpaceResourceMovesService } from './space-resource-moves.service';

const input = {
  resourceType: 'breakdown' as const,
  resourceId: '00000000-0000-4000-8000-000000000101',
  targetSpaceId: '00000000-0000-4000-8000-000000000003',
};

function membership(spaceId: string, userId: string) {
  return { spaceId, userId };
}

function harness(options: { updateCount?: number; membershipSets?: object[] } = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: options.updateCount ?? 1 });
  const tx = {
    projectMembership: {
      findUnique: vi.fn().mockResolvedValue({
        role: {
          archivedAt: null,
          isOwner: true,
          permissions: [{ permission: 'manage_project_settings' }],
        },
      }),
      findMany: vi.fn().mockResolvedValue([{ userId: 'direct-user' }]),
    },
    spaceMembership: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          options.membershipSets ?? [
            membership('source-space', 'source-only'),
            membership('source-space', 'direct-user'),
            membership(input.targetSpaceId, 'target-only'),
            membership(input.targetSpaceId, 'direct-user'),
          ],
        ),
    },
    spaceResource: { updateMany, upsert: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const permissions = { assert: vi.fn().mockResolvedValue({ id: 'space-membership' }) };
  return {
    service: new SpaceResourceMovesService(prisma as never, permissions as never),
    prisma,
    permissions,
    tx,
    updateMany,
  };
}

describe('SpaceResourceMovesService', () => {
  it('preflights the symmetric difference and excludes direct resource members', async () => {
    const { service } = harness();

    await expect(service.preflight('owner', 'source-space', input)).resolves.toEqual({
      gainsAccess: ['target-only'],
      losesAccess: ['source-only'],
    });
  });

  it('requires move_resources in both the source and target Spaces', async () => {
    const { service, permissions } = harness();
    permissions.assert.mockRejectedValueOnce(new ForbiddenException('Missing permission'));

    await expect(service.preflight('owner', 'source-space', input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(permissions.assert).toHaveBeenCalledWith('owner', 'source-space', 'move_resources');
    expect(permissions.assert).toHaveBeenCalledWith('owner', input.targetSpaceId, 'move_resources');
  });

  it('requires move_resources when leaving a personal Default Space', async () => {
    const { service, permissions } = harness();

    await expect(service.preflight('owner', DEFAULT_SPACE_ID, input)).resolves.toEqual({
      gainsAccess: ['target-only'],
      losesAccess: [],
    });
    expect(permissions.assert).toHaveBeenCalledWith(
      'owner',
      DEFAULT_SPACE_ID,
      'move_resources',
    );
    expect(permissions.assert).toHaveBeenCalledWith('owner', input.targetSpaceId, 'move_resources');
  });

  it('requires move_resources when returning to a personal Default Space', async () => {
    const { service, permissions } = harness();
    const returnToDefault = { ...input, targetSpaceId: DEFAULT_SPACE_ID };

    await expect(service.preflight('owner', 'source-space', returnToDefault)).resolves.toEqual({
      gainsAccess: [],
      losesAccess: ['source-only'],
    });
    expect(permissions.assert).toHaveBeenCalledWith('owner', 'source-space', 'move_resources');
    expect(permissions.assert).toHaveBeenCalledWith(
      'owner',
      DEFAULT_SPACE_ID,
      'move_resources',
    );
  });

  it('moves only the Space mapping and leaves direct memberships untouched', async () => {
    const { service, tx, updateMany } = harness();

    await expect(service.move('owner', 'source-space', input)).resolves.toMatchObject({
      resourceId: input.resourceId,
      gainsAccess: ['target-only'],
      losesAccess: ['source-only'],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        resourceType: 'breakdown',
        resourceId: input.resourceId,
        spaceId: 'source-space',
      },
      data: { spaceId: input.targetSpaceId },
    });
    expect(tx.projectMembership.findMany).toHaveBeenCalledOnce();
  });

  it('refuses to move a resource whose explicit mapping has disappeared', async () => {
    const { service, tx, updateMany } = harness({ updateCount: 0 });

    await expect(service.move('owner', DEFAULT_SPACE_ID, input)).rejects.toThrow(
      'Resource location has changed',
    );
    expect(updateMany).toHaveBeenCalledOnce();
    expect(tx.spaceResource.upsert).not.toHaveBeenCalled();
  });
});
