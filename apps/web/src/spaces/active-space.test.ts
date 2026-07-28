import { describe, expect, it } from 'vitest';
import type { SpaceSummary } from '../api';
import { resolveActiveSpaceId } from './active-space';

const SPACES: readonly SpaceSummary[] = [
  {
    id: 'first',
    name: 'First Space',
    currentMembership: null,
    resourceCounts: { breakdown: 0, screenplay: 0 },
  },
  {
    id: 'second',
    name: 'Second Space',
    currentMembership: null,
    resourceCounts: { breakdown: 1, screenplay: 2 },
  },
];

describe('resolveActiveSpaceId', () => {
  it('keeps the persisted Space while it remains visible', () => {
    expect(resolveActiveSpaceId(SPACES, 'second')).toBe('second');
  });

  it('falls back to the first visible Space when persisted access becomes stale', () => {
    expect(resolveActiveSpaceId(SPACES, 'removed-space')).toBe('first');
  });

  it('has no active Space when the caller cannot see any Spaces', () => {
    expect(resolveActiveSpaceId([], 'removed-space')).toBeUndefined();
  });
});
