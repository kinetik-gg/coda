// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceSummary } from '../api';
import { ACTIVE_SPACE_STORAGE_KEY, resolveActiveSpaceId, useActiveSpace } from './active-space';

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

function ActiveSpaceProbe() {
  const { activeSpace } = useActiveSpace();
  return <span>{activeSpace?.name ?? 'No active Space'}</span>;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: SPACES }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

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

  it('replaces a stale persisted Space id with the first visible Space', async () => {
    localStorage.setItem(ACTIVE_SPACE_STORAGE_KEY, 'removed-space');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActiveSpaceProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('First Space')).toBeVisible();
    expect(localStorage.getItem(ACTIVE_SPACE_STORAGE_KEY)).toBe('first');
  });
});
