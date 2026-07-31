// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { importScreenplayViaAdapter } from './screenplay-adapter-import';
import { SCREENPLAY_IMPORT_FORMATS } from './screenplay-import-formats';

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function formatFor(sourceFormat: string) {
  const format = SCREENPLAY_IMPORT_FORMATS.find((entry) => entry.sourceFormat === sourceFormat);
  if (!format) throw new Error(`No format registered for ${sourceFormat}`);
  return format;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importScreenplayViaAdapter', () => {
  it('reserves, uploads, converts, and applies the Fountain to a placeholder screenplay', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/screenplays' && method === 'POST') {
        return response({ id: 'sp-id', version: 1 });
      }
      if (path === '/api/v1/screenplays/sp-id/import-artifacts' && method === 'POST') {
        expect(JSON.parse(init?.body as string)).toMatchObject({ sourceFormat: 'final-draft' });
        return response({
          id: 'artifact-id',
          version: 1,
          uploadUrl: 'https://upload.test/put',
          directUpload: true,
        });
      }
      if (path === 'https://upload.test/put' && method === 'PUT') {
        expect((init?.headers as Record<string, string>)['content-type']).toBe('application/xml');
        expect((init?.headers as Record<string, string>)['if-none-match']).toBe('*');
        expect(init?.credentials).toBeUndefined();
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (
        path === '/api/v1/screenplays/sp-id/import-artifacts/artifact-id/convert' &&
        method === 'POST'
      ) {
        expect(JSON.parse(init?.body as string)).toEqual({ version: 1 });
        return response({ convertedFountain: 'INT. ROOM - DAY\n' });
      }
      if (path === '/api/v1/screenplays/sp-id' && method === 'PATCH') {
        expect(JSON.parse(init?.body as string)).toEqual({
          sourceText: 'INT. ROOM - DAY\n',
          version: 1,
        });
        return response({ id: 'sp-id', version: 2 });
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['<FinalDraft/>'], 'My Draft.fdx', { type: 'application/xml' });
    await expect(importScreenplayViaAdapter(file, formatFor('final-draft'))).resolves.toBe('sp-id');
  });

  it.each([
    ['html', 'text/html'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['pdf', 'application/pdf'],
    ['rtf', 'application/rtf'],
  ])('uploads %s with its declared MIME type', async (sourceFormat, mimeType) => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/screenplays' && method === 'POST') {
        return response({ id: 'sp-id', version: 1 });
      }
      if (path === '/api/v1/screenplays/sp-id/import-artifacts' && method === 'POST') {
        expect(JSON.parse(init?.body as string)).toMatchObject({ sourceFormat, mimeType });
        return response({
          id: 'artifact-id',
          version: 1,
          uploadUrl: 'https://upload.test/put',
          directUpload: true,
        });
      }
      if (path === 'https://upload.test/put' && method === 'PUT') {
        expect((init?.headers as Record<string, string>)['content-type']).toBe(mimeType);
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (
        path === '/api/v1/screenplays/sp-id/import-artifacts/artifact-id/convert' &&
        method === 'POST'
      ) {
        return response({ convertedFountain: 'INT. ROOM - DAY\n' });
      }
      if (path === '/api/v1/screenplays/sp-id' && method === 'PATCH') {
        return response({ id: 'sp-id', version: 2 });
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['bytes'], `document.${sourceFormat}`);
    await expect(importScreenplayViaAdapter(file, formatFor(sourceFormat))).resolves.toBe('sp-id');
  });

  it('derives a title from the filename, falling back when the stem is empty', async () => {
    const titles: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/screenplays' && init?.method === 'POST') {
        titles.push((JSON.parse(init.body as string) as { title: string }).title);
        return response({ id: 'sp-id', version: 1 });
      }
      return response({ title: 'boom', status: 400, detail: 'nope' }, 400);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      importScreenplayViaAdapter(
        new File(['x'], '.fdx', { type: 'application/xml' }),
        formatFor('final-draft'),
      ),
    ).rejects.toThrow();
    expect(titles).toEqual(['Untitled screenplay']);
  });

  it('rolls back the placeholder screenplay when a later step fails', async () => {
    const deleted: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/screenplays' && method === 'POST') {
        return response({ id: 'sp-id', version: 1 });
      }
      if (path === '/api/v1/screenplays/sp-id/import-artifacts' && method === 'POST') {
        return response({ title: 'Unsupported', status: 400, detail: 'Bad format' }, 400);
      }
      if (path === '/api/v1/screenplays/sp-id' && method === 'DELETE') {
        deleted.push(path);
        return response({ id: 'sp-id' });
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      importScreenplayViaAdapter(
        new File(['<FinalDraft/>'], 'draft.fdx'),
        formatFor('final-draft'),
      ),
    ).rejects.toThrow('Bad format');
    expect(deleted).toEqual(['/api/v1/screenplays/sp-id']);
  });

  it('surfaces an upload failure without swallowing it, still rolling back', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/screenplays' && method === 'POST') {
        return response({ id: 'sp-id', version: 1 });
      }
      if (path === '/api/v1/screenplays/sp-id/import-artifacts' && method === 'POST') {
        return response({
          id: 'artifact-id',
          version: 1,
          uploadUrl: 'https://upload.test/put',
          directUpload: false,
        });
      }
      if (path === 'https://upload.test/put' && method === 'PUT') {
        expect(init?.credentials).toBe('same-origin');
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      if (path === '/api/v1/screenplays/sp-id' && method === 'DELETE') {
        return response({ id: 'sp-id' });
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      importScreenplayViaAdapter(
        new File(['<FinalDraft/>'], 'draft.fdx'),
        formatFor('final-draft'),
      ),
    ).rejects.toThrow('The screenplay file could not be uploaded.');
  });
});
