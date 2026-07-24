import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiCursorPage, uploadFile, uploadToSignedUrl } from './api';

afterEach(() => vi.restoreAllMocks());

describe('api client', () => {
  it('unwraps successful envelopes', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'one' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(api<{ id: string }>('/api/v1/example')).resolves.toEqual({ id: 'one' });
  });

  it('preserves cursor metadata for paged responses', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'one' }], meta: { nextCursor: 'next' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(apiCursorPage<{ id: string }>('/api/v1/example')).resolves.toEqual({
      items: [{ id: 'one' }],
      nextCursor: 'next',
    });
  });

  it('throws RFC problem details for failed responses', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: 'test',
            title: 'Conflict',
            status: 409,
            detail: 'stale version',
          }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await expect(api('/api/v1/example')).rejects.toThrow('stale version');
  });

  it('adds JSON and decoded CSRF headers to state-changing browser requests', async () => {
    vi.stubGlobal('document', { cookie: 'other=x; coda_csrf=token%20value' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/v1/example', { method: 'POST', body: JSON.stringify({ value: 1 }) });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-coda-csrf')).toBe('token value');
    expect(init.credentials).toBe('same-origin');
  });

  it('preserves caller headers and omits CSRF for safe methods', async () => {
    vi.stubGlobal('document', { cookie: 'coda_csrf=token' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/v1/example', { method: 'HEAD', headers: { accept: 'application/json' } });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('x-coda-csrf')).toBe(false);
  });

  it('uploads with the file content type and rejects object-store failures', async () => {
    const file = new File(['content'], 'source.pdf', { type: 'application/pdf' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadToSignedUrl('https://objects.test/upload', file)).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': file.type, 'if-none-match': '*' },
      body: file,
    });
    expect(init.headers).toEqual({ 'content-type': 'application/pdf', 'if-none-match': '*' });
    await expect(uploadToSignedUrl('https://objects.test/upload', file)).rejects.toThrow(
      'The object store rejected the upload.',
    );
  });

  it('selects the direct presigned path when the API advertises directUpload', async () => {
    const file = new File(['content'], 'source.pdf', { type: 'application/pdf' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await uploadFile({ uploadUrl: 'https://objects.test/upload', directUpload: true }, file);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ 'content-type': 'application/pdf', 'if-none-match': '*' });
  });

  it('selects the app-proxied path when directUpload is false', async () => {
    const file = new File(['content'], 'source.pdf', { type: 'application/pdf' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await uploadFile({ uploadUrl: '/api/v1/uploads/token', directUpload: false }, file);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      credentials: 'same-origin',
    });
    expect(init.headers).not.toHaveProperty('if-none-match');
    await expect(
      uploadFile({ uploadUrl: '/api/v1/uploads/token', directUpload: false }, file),
    ).rejects.toThrow('The upload was rejected.');
  });
});
