import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from '../spaces/space-constants';
import { SpaceResourceReconciler } from './space-resource-reconciler';

interface Mapping {
  id: string;
  spaceId: string;
  resourceType: string;
  resourceId: string;
  position: string;
}

const createdAt = new Date('2026-07-28T00:00:00.000Z');

function reconciliationHarness() {
  const projects = [
    { id: 'project-live', createdAt },
    { id: 'project-deleted', createdAt: new Date('2026-07-28T00:00:01.000Z') },
  ];
  const screenplays = [{ id: 'screenplay-live', createdAt }];
  const mappings: Mapping[] = [
    {
      id: 'mapping-project',
      spaceId: DEFAULT_SPACE_ID,
      resourceType: 'breakdown',
      resourceId: 'project-live',
      position: '00000001',
    },
    {
      id: 'orphan-project',
      spaceId: DEFAULT_SPACE_ID,
      resourceType: 'breakdown',
      resourceId: 'missing-project',
      position: '00000003',
    },
    {
      id: 'orphan-screenplay',
      spaceId: DEFAULT_SPACE_ID,
      resourceType: 'screenplay',
      resourceId: 'missing-screenplay',
      position: '00000002',
    },
    {
      id: 'future-resource',
      spaceId: DEFAULT_SPACE_ID,
      resourceType: 'future',
      resourceId: 'future-resource',
      position: '00000001',
    },
  ];
  let nextId = 1;
  const tx = {
    project: { findMany: vi.fn().mockResolvedValue(projects) },
    screenplay: { findMany: vi.fn().mockResolvedValue(screenplays) },
    spaceResource: {
      findMany: vi.fn(({ where: { resourceType } }) =>
        Promise.resolve(
          mappings
            .filter((mapping) => mapping.resourceType === resourceType)
            .map(({ id, resourceId }) => ({ id, resourceId })),
        ),
      ),
      createMany: vi.fn(({ data }: { data: Omit<Mapping, 'id'>[] }) => {
        let count = 0;
        for (const row of data) {
          if (
            mappings.some(
              (mapping) =>
                mapping.resourceType === row.resourceType && mapping.resourceId === row.resourceId,
            )
          )
            continue;
          mappings.push({ id: `created-${nextId++}`, ...row });
          count += 1;
        }
        return Promise.resolve({ count });
      }),
      deleteMany: vi.fn(
        ({
          where: {
            id: { in: ids },
          },
        }: {
          where: { id: { in: string[] } };
        }) => {
          let count = 0;
          for (let index = mappings.length - 1; index >= 0; index -= 1) {
            if (!ids.includes(mappings[index]!.id)) continue;
            mappings.splice(index, 1);
            count += 1;
          }
          return Promise.resolve({ count });
        },
      ),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  return { mappings, reconciler: new SpaceResourceReconciler(prisma as never) };
}

describe('SpaceResourceReconciler', () => {
  it('fills missing mappings, removes typed orphans, keeps deleted resources, and is repeat-safe', async () => {
    const { mappings, reconciler } = reconciliationHarness();

    await expect(reconciler.reconcile()).resolves.toEqual({ created: 2, deleted: 2 });
    expect(
      mappings.map(({ resourceType, resourceId, position }) => ({
        resourceType,
        resourceId,
        position,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          resourceType: 'breakdown',
          resourceId: 'project-live',
          position: '00000001',
        },
        {
          resourceType: 'breakdown',
          resourceId: 'project-deleted',
          position: '00000002',
        },
        {
          resourceType: 'screenplay',
          resourceId: 'screenplay-live',
          position: '00000001',
        },
        { resourceType: 'future', resourceId: 'future-resource', position: '00000001' },
      ]),
    );
    expect(mappings.map(({ resourceId }) => resourceId)).not.toEqual(
      expect.arrayContaining(['missing-project', 'missing-screenplay']),
    );

    const snapshot = structuredClone(mappings);
    await expect(reconciler.reconcile()).resolves.toEqual({ created: 0, deleted: 0 });
    expect(mappings).toEqual(snapshot);
  });
});
