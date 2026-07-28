import { describe, expect, it } from 'vitest';
import { allResourceTypes, permissionsForResourceTier } from '@coda/contracts';
import { spaceResourceRegistry, spaceResourceRegistryEntries } from './space-resource-registry';

describe('Space resource registry', () => {
  it('drives every registered resource type from the contracts vocabulary', () => {
    const entries = spaceResourceRegistryEntries();
    expect(entries.map(([resourceType]) => resourceType)).toEqual(allResourceTypes);
    for (const [resourceType, entry] of entries) {
      expect(entry.tierPermissions('viewer')).toEqual(
        permissionsForResourceTier(resourceType, 'viewer'),
      );
      expect(entry).toMatchObject({
        listAccessibleResourceIds: expect.any(Function),
        resolveOwner: expect.any(Function),
        movePreflight: expect.any(Function),
      });
    }
    expect(Object.keys(spaceResourceRegistry)).toEqual(allResourceTypes);
  });
});
