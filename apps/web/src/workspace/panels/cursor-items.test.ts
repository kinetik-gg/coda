import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllCursorItems, withCursor } from './cursor-items';

afterEach(() => vi.restoreAllMocks());

describe('cursor item loading', () => {
  it('encodes a cursor without disturbing existing query parameters', () => {
    expect(withCursor('/items?limit=250', 'next/page')).toBe('/items?limit=250&cursor=next%2Fpage');
  });

  it('loads every page for complete parent selectors', async () => {
    vi.stubGlobal('document', { cookie: '' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'one' }], meta: { nextCursor: 'next' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'two' }], meta: { nextCursor: null } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAllCursorItems<{ id: string }>('/items?limit=250')).resolves.toEqual([
      { id: 'one' },
      { id: 'two' },
    ]);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual(['/items?limit=250', '/items?limit=250&cursor=next']);
  });
});
