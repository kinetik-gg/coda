// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLayout } from '@coda/contracts';
import { createDefaultTrackerWorkspaceLayout } from './tracker-recipes';

const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(readonly problem: { status: number; title: string; type: string }) {
      super(problem.title);
    }
  }
  return { MockApiError };
});

let layoutFactory: () => WorkspaceLayout;
vi.mock('../api', () => ({
  api: vi.fn(),
  ApiError: MockApiError,
}));

import { api } from '../api';
import { useTrackerLayoutSync } from './useTrackerLayoutSync';

const mockedApi = vi.mocked(api);

function stored(layout: WorkspaceLayout, revision: number) {
  return { personal: { layout, revision }, default: { layout, revision }, canPublish: true };
}

afterEach(cleanup);
beforeEach(() => {
  mockedApi.mockReset();
  layoutFactory = createDefaultTrackerWorkspaceLayout;
});

describe('useTrackerLayoutSync', () => {
  it('hydrates the personal tier from the tracker layout endpoint', () => {
    const layout = layoutFactory();
    const { result } = renderHook(() => useTrackerLayoutSync('t1', stored(layout, 3)));
    expect(result.current.layout).toEqual(layout);
    expect(result.current.persistState).toBe('saved');
  });

  it('rebases and silently retries a conflicting save against the latest revision', async () => {
    const layout = layoutFactory();
    let puts = 0;
    const expectedRevisions: number[] = [];
    mockedApi.mockImplementation((url, options) => {
      const target = String(url);
      if (target.endsWith('/workspace-layout') && options?.method === 'PUT') {
        puts += 1;
        const body = JSON.parse(options.body as string) as { expectedRevision: number };
        expectedRevisions.push(body.expectedRevision);
        return puts === 1
          ? Promise.reject(new MockApiError({ status: 409, title: 'stale', type: 'about:blank' }))
          : Promise.resolve({ layout, revision: 7 });
      }
      if (target.endsWith('/workspace-layout')) return Promise.resolve(stored(layout, 5));
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useTrackerLayoutSync('t1', stored(layout, 1)));
    act(() =>
      result.current.commit({
        ...layout,
        view: { zoom: 1, textScale: 0.8 },
      }),
    );
    await waitFor(() => expect(puts).toBe(2), { timeout: 2000 });
    // The retry used the refetched revision (5), not the stale one (1).
    expect(expectedRevisions).toEqual([1, 5]);
    expect(result.current.persistState).toBe('saved');
    expect(result.current.operationError).toBeUndefined();
  });

  it('toasts only when the rebase retry also conflicts', async () => {
    const layout = layoutFactory();
    mockedApi.mockImplementation((url, options) => {
      const target = String(url);
      if (target.endsWith('/workspace-layout') && options?.method === 'PUT')
        return Promise.reject(new MockApiError({ status: 409, title: 'stale', type: 'a' }));
      if (target.endsWith('/workspace-layout')) return Promise.resolve(stored(layout, 5));
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useTrackerLayoutSync('t1', stored(layout, 1)));
    act(() => result.current.commit({ ...layout, view: { zoom: 1, textScale: 0.8 } }));
    await waitFor(() => expect(result.current.operationError).toBe('stale'), {
      timeout: 2000,
    });
    expect(result.current.persistState).toBe('error');
  });

  it('raises an explicit publish conflict instead of an error toast', async () => {
    const layout = layoutFactory();
    mockedApi.mockImplementation((url) => {
      const target = String(url);
      if (target.endsWith('/publish'))
        return Promise.reject(new MockApiError({ status: 409, title: 'raced', type: 'a' }));
      if (target.endsWith('/workspace-layout')) return Promise.resolve(stored(layout, 6));
      if (target.endsWith('/reset')) return Promise.resolve({ layout, revision: 2 });
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useTrackerLayoutSync('t1', stored(layout, 1)));
    await act(() => result.current.publish());
    expect(result.current.publishConflict).toBeDefined();
    expect(result.current.operationError).toBeUndefined();
    // Adopting the latest default makes it dirty so the debounce persists it.
    act(() => result.current.adoptLatestDefault());
    expect(result.current.publishConflict).toBeUndefined();
  });

  it('resets through the tracker reset endpoint with the current revision', async () => {
    const layout = layoutFactory();
    mockedApi.mockImplementation((url) => {
      const target = String(url);
      if (target.endsWith('/reset')) return Promise.resolve({ layout, revision: 4 });
      if (target.endsWith('/workspace-layout')) return Promise.resolve(stored(layout, 1));
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useTrackerLayoutSync('t1', stored(layout, 1)));
    await act(() => result.current.reset());
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/trackers/t1/workspace-layout/reset',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.current.layout).toEqual(layout);
  });

  it('flushes a dirty layout before publishing', async () => {
    const layout = layoutFactory();
    const calls: string[] = [];
    mockedApi.mockImplementation((url, options) => {
      const target = String(url);
      const method = options?.method ?? 'GET';
      if (target.endsWith('/workspace-layout') && method === 'PUT') {
        calls.push('save');
        return Promise.resolve({ layout, revision: 2 });
      }
      if (target.endsWith('/publish')) {
        calls.push('publish');
        return Promise.resolve({ layout, revision: 3 });
      }
      if (target.endsWith('/workspace-layout')) return Promise.resolve(stored(layout, 1));
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useTrackerLayoutSync('t1', stored(layout, 1)));
    act(() => result.current.commit({ ...layout, view: { zoom: 1, textScale: 0.9 } }));
    await act(() => result.current.publish());
    expect(calls).toEqual(['save', 'publish']);
  });
});
