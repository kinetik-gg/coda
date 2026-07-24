// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPanelSlots } from '../workspace/layout';
import {
  createDefaultScreenplayPanelLayout,
  reduceScreenplayPanelLayout,
  type ScreenplayPanelLayout,
} from './screenplay-panel-layout';
import { mergeScreenplaySaveState, useScreenplayPanelLayout } from './useScreenplayPanelLayout';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function dataResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problemResponse(status: number): Response {
  return new Response(JSON.stringify({ status, title: 'Conflict', detail: 'changed' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A three-panel layout, distinguishable from the default four-panel layout. */
function threePanelLayout(): ScreenplayPanelLayout {
  const base = createDefaultScreenplayPanelLayout();
  const slot = collectPanelSlots(base.root).find(
    (candidate) => candidate.panel.type === 'preview',
  )!;
  return reduceScreenplayPanelLayout(base, { type: 'close', slotId: slot.id });
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

interface FetchCall {
  path: string;
  method: string;
  body?: unknown;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => setOnline(true));

describe('mergeScreenplaySaveState', () => {
  it('keeps whichever save state most warrants attention', () => {
    expect(mergeScreenplaySaveState('saved', 'saving')).toBe('saving');
    expect(mergeScreenplaySaveState('failed', 'saving')).toBe('failed');
    expect(mergeScreenplaySaveState('unsaved', 'loading')).toBe('unsaved');
    expect(mergeScreenplaySaveState('saved', 'saved')).toBe('saved');
  });
});

describe('useScreenplayPanelLayout local behaviour', () => {
  it('falls back from invalid storage, mirrors changes, and restores history', async () => {
    localStorage.setItem('coda:screenplay-layout:script', '{not-json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dataResponse(null)));
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'script', onError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(4);

    act(() => result.current.togglePanelKind('preview'));
    expect(collectPanelSlots(result.current.layout.root).map((slot) => slot.panel.type)).toEqual([
      'editor',
      'outline',
      'inventory',
    ]);
    expect(result.current.canUndo).toBe(true);
    expect(localStorage.getItem('coda:screenplay-layout:script')).toContain('editor');

    act(() => result.current.undo());
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(4);
    expect(result.current.canUndo).toBe(false);
  });

  it('adds a missing typed panel and reports reducer validation failures', async () => {
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dataResponse(null)));
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'script', onError }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.saveState).toBe('saved'));

    act(() => result.current.togglePanelKind('inventory'));
    expect(
      collectPanelSlots(result.current.layout.root).map((slot) => slot.panel.type),
    ).not.toContain('inventory');
    act(() => result.current.togglePanelKind('inventory'));
    expect(collectPanelSlots(result.current.layout.root).map((slot) => slot.panel.type)).toContain(
      'inventory',
    );

    const duplicateId = result.current.layout.root.id;
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      duplicateId as `${string}-${string}-${string}-${string}-${string}`,
    );
    act(() => result.current.togglePanelKind('inventory'));
    act(() => result.current.togglePanelKind('inventory'));
    expect(onError).toHaveBeenCalledWith('Panel IDs must be unique');
  });

  it('keeps the only visible panel when reducing', async () => {
    let single = createDefaultScreenplayPanelLayout();
    for (const kind of ['preview', 'outline', 'inventory'] as const) {
      const slot = collectPanelSlots(single.root).find(
        (candidate) => candidate.panel.type === kind,
      )!;
      single = reduceScreenplayPanelLayout(single, { type: 'close', slotId: slot.id });
    }
    localStorage.setItem('coda:screenplay-layout:single', JSON.stringify(single));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dataResponse(null)));
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'single', onError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => collectPanelSlots(result.current.layout.root).length === 1);

    act(() => result.current.togglePanelKind('editor'));
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(1);
  });
});

describe('useScreenplayPanelLayout server sync', () => {
  it('adopts the server layout when one already exists', async () => {
    const serverLayout = threePanelLayout();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        dataResponse({
          layout: serverLayout,
          revision: 7,
          schemaVersion: serverLayout.schemaVersion,
        }),
      ),
    );
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'script', onError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(3);
  });

  it('imports an existing local layout once when the server has no row', async () => {
    const local = threePanelLayout();
    localStorage.setItem('coda:screenplay-layout:script', JSON.stringify(local));
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({
          path,
          method,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        if (method === 'PUT') {
          return Promise.resolve(dataResponse({ layout: local, revision: 1, schemaVersion: 2 }));
        }
        return Promise.resolve(dataResponse(null));
      }),
    );
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'script', onError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    const put = calls.find((call) => call.method === 'PUT');
    expect(put).toBeDefined();
    expect((put?.body as { expectedRevision: number }).expectedRevision).toBe(0);
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(3);
  });

  it('resyncs to the server layout on a revision conflict', async () => {
    const server = threePanelLayout();
    let putCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'PUT') {
          putCount += 1;
          return Promise.resolve(problemResponse(409));
        }
        // First GET seeds an empty default; the post-conflict GET returns the winning server layout.
        if (putCount === 0) return Promise.resolve(dataResponse(null));
        return Promise.resolve(
          dataResponse({ layout: server, revision: 9, schemaVersion: server.schemaVersion }),
        );
      }),
    );
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'script', onError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.saveState).toBe('saved'));

    // Removing 'outline' locally is the change that conflicts; the resync must restore the
    // server's winning layout (which still contains 'outline') and settle back to 'saved'.
    act(() => result.current.togglePanelKind('outline'));
    await waitFor(
      () => {
        expect(putCount).toBeGreaterThan(0);
        const types = collectPanelSlots(result.current.layout.root).map((slot) => slot.panel.type);
        expect(types).toContain('outline');
      },
      { timeout: 2000 },
    );
    expect(result.current.saveState).toBe('saved');
  });

  it('holds changes locally while offline and flushes them when back online', async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ path, method });
        if (method === 'PUT') {
          return Promise.resolve(dataResponse({ layout: {}, revision: 1, schemaVersion: 2 }));
        }
        return Promise.resolve(dataResponse(null));
      }),
    );
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'script', onError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.saveState).toBe('saved'));

    setOnline(false);
    act(() => result.current.togglePanelKind('preview'));
    await waitFor(() => expect(result.current.saveState).toBe('offline'));
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    // The layout is still mirrored locally so the change is not lost.
    expect(localStorage.getItem('coda:screenplay-layout:script')).toBeTruthy();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true), {
      timeout: 2000,
    });
  });

  it('reports a failed save without losing the local layout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'PUT') return Promise.resolve(problemResponse(500));
        return Promise.resolve(dataResponse(null));
      }),
    );
    const { result } = renderHook(
      () => useScreenplayPanelLayout({ screenplayId: 'script', onError: vi.fn() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.saveState).toBe('saved'));

    act(() => result.current.togglePanelKind('preview'));
    await waitFor(() => expect(result.current.saveState).toBe('failed'), { timeout: 2000 });
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(3);
  });
});
