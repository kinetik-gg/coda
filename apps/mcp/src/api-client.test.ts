import { describe, expect, it, vi } from 'vitest';
import { CodaApiClient, CodaApiError } from './api-client.js';
import type { McpConfig } from './config.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const entityTypeId = '22222222-2222-4222-8222-222222222222';
const token = `coda_mcp_${'a'.repeat(43)}`;

const config: McpConfig = {
  apiOrigin: 'https://coda.example',
  token,
  timeoutMs: 1_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

function requestUrl(input: URL | RequestInfo): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

describe('CodaApiClient', () => {
  it('binds requests to the MCP token project and sends the MCP audience', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
      expect(new Headers(init?.headers).get('x-coda-token-audience')).toBe('mcp');
      if (url.endsWith('/api/v1/token/context')) {
        return Promise.resolve(
          jsonResponse({ data: { projectId, kind: 'MCP_TOKEN', permissions: ['read_project'] } }),
        );
      }
      expect(url).toBe(
        `https://coda.example/api/v1/projects/${projectId}/items?entityTypeId=${entityTypeId}&limit=25&sort=manual&direction=asc`,
      );
      return Promise.resolve(
        jsonResponse({ data: [{ id: 'item' }], meta: { nextCursor: 'next' } }),
      );
    });
    const client = new CodaApiClient(config, fetchMock);

    await expect(
      client.listItems({ entityTypeId, limit: 25, sort: 'manual', direction: 'asc' }),
    ).resolves.toEqual({ items: [{ id: 'item' }], nextCursor: 'next' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps RFC problem details into a concise tool-safe error', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse(
          {
            title: 'Conflict',
            status: 409,
            detail: 'Item has changed; refresh and retry',
            errors: { version: ['Expected the current version'] },
          },
          409,
        ),
      ),
    );
    const client = new CodaApiClient(config, fetchMock);

    const error = await client.context().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodaApiError);
    expect((error as CodaApiError).publicMessage()).toContain(
      'version: Expected the current version',
    );
    expect((error as CodaApiError).publicMessage()).not.toContain(token);
  });

  it('rejects a project response outside the token context', async () => {
    const otherProjectId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (requestUrl(input).endsWith('/api/v1/token/context')) {
        return Promise.resolve(
          jsonResponse({ data: { projectId, kind: 'MCP_TOKEN', permissions: [] } }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            id: otherProjectId,
            name: 'Example project',
            description: null,
            version: 1,
            revision: 0,
            updatedAt: '2026-01-01T00:00:00.000Z',
            entityTypes: [],
            sourceDocuments: [],
          },
        }),
      );
    });
    const client = new CodaApiClient(config, fetchMock);

    await expect(client.getProject()).rejects.toThrow('outside token scope');
  });

  it('maps source metadata from the public project response shape', async () => {
    const documentId = '44444444-4444-4444-8444-444444444444';
    const storageObjectId = '55555555-5555-4555-8555-555555555555';
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (requestUrl(input).endsWith('/api/v1/token/context')) {
        return Promise.resolve(
          jsonResponse({ data: { projectId, kind: 'MCP_TOKEN', permissions: ['read_project'] } }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            id: projectId,
            name: 'Example project',
            description: null,
            version: 1,
            revision: 2,
            updatedAt: '2026-01-01T00:00:00.000Z',
            entityTypes: [],
            sourceDocuments: [
              {
                id: documentId,
                title: 'Example source',
                pageCount: 12,
                version: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
                storageObject: {
                  id: storageObjectId,
                  originalFilename: 'example.pdf',
                  mimeType: 'application/pdf',
                  sizeBytes: '2048',
                  status: 'READY',
                  objectKey: 'internal/value-not-returned',
                },
              },
            ],
          },
        }),
      );
    });
    const client = new CodaApiClient(config, fetchMock);

    await expect(client.getSource()).resolves.toEqual({
      projectId,
      documents: [
        {
          id: documentId,
          title: 'Example source',
          pageCount: 12,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          file: {
            id: storageObjectId,
            filename: 'example.pdf',
            mimeType: 'application/pdf',
            sizeBytes: '2048',
            status: 'READY',
          },
        },
      ],
    });
  });

  it('reads schema and dispatches item mutations and activity pagination', async () => {
    const itemId = '66666666-6666-4666-8666-666666666666';
    const fieldId = '77777777-7777-4777-8777-777777777777';
    const activity = Array.from({ length: 100 }, (_, index) => ({
      id: index === 99 ? '88888888-8888-4888-8888-888888888888' : `event-${index}`,
    }));
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/v1/token/context')) {
        return Promise.resolve(
          jsonResponse({ data: { projectId, kind: 'MCP_TOKEN', permissions: ['read_project'] } }),
        );
      }
      if (url.endsWith(`/entity-types/${entityTypeId}/fields`)) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: fieldId,
                entityTypeId,
                name: 'Status',
                key: 'status',
                type: 'text',
                required: false,
                position: 'a',
                configuration: {},
                version: 1,
                options: [],
              },
            ],
          }),
        );
      }
      if (url.endsWith(`/items/${itemId}`) && init?.method === 'PATCH') {
        if (typeof init.body !== 'string') throw new Error('Expected JSON request body');
        expect(JSON.parse(init.body) as unknown).toEqual({ version: 1, title: 'Updated' });
        return Promise.resolve(
          jsonResponse({ data: { id: itemId, title: 'Updated', version: 2 } }),
        );
      }
      if (url.endsWith('/items') && init?.method === 'POST') {
        if (typeof init.body !== 'string') throw new Error('Expected JSON request body');
        expect(JSON.parse(init.body) as unknown).toEqual({ entityTypeId, title: 'Created' });
        return Promise.resolve(
          jsonResponse({ data: { id: itemId, title: 'Created', version: 1 } }),
        );
      }
      if (url.includes('/activity')) {
        expect(url).toContain('cursor=cursor%2Fvalue');
        return Promise.resolve(jsonResponse({ data: activity }));
      }
      if (url.endsWith(`/api/v1/projects/${projectId}`)) {
        return Promise.resolve(
          jsonResponse({
            data: {
              id: projectId,
              name: 'Example project',
              description: null,
              version: 1,
              revision: 3,
              updatedAt: '2026-01-01T00:00:00.000Z',
              entityTypes: [
                {
                  id: entityTypeId,
                  parentTypeId: null,
                  singularName: 'Item',
                  pluralName: 'Items',
                  displayPrefix: null,
                  level: 1,
                  position: 'a',
                  enabled: true,
                  version: 1,
                  _count: { items: 4 },
                },
              ],
              sourceDocuments: [],
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const client = new CodaApiClient(config, fetchMock);

    await expect(client.getProject()).resolves.toEqual(
      expect.objectContaining({
        id: projectId,
        hasSourceDocument: false,
        levels: [expect.objectContaining({ id: entityTypeId, itemCount: 4 })],
      }),
    );
    await expect(client.getSchema()).resolves.toEqual({
      projectId,
      revision: 3,
      levels: [
        expect.objectContaining({
          id: entityTypeId,
          fields: [expect.objectContaining({ id: fieldId, key: 'status' })],
        }),
      ],
    });
    await expect(client.createItem({ entityTypeId, title: 'Created' })).resolves.toEqual(
      expect.objectContaining({ id: itemId }),
    );
    await expect(client.updateItem({ itemId, version: 1, title: 'Updated' })).resolves.toEqual(
      expect.objectContaining({ version: 2 }),
    );
    await expect(client.listActivity('cursor/value')).resolves.toEqual({
      events: activity,
      nextCursor: '88888888-8888-4888-8888-888888888888',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/items/${itemId}`),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('includes optional list filters and handles non-problem API errors safely', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/v1/token/context')) {
        return Promise.resolve(
          jsonResponse({ data: { projectId, kind: 'MCP_TOKEN', permissions: [] } }),
        );
      }
      if (url.includes('/items?')) {
        expect(url).toContain('parentId=');
        expect(url).toContain('cursor=next%2Fpage');
        expect(url).toContain('search=quiet+signal');
        return Promise.resolve(jsonResponse({ data: [], meta: {} }));
      }
      return Promise.resolve(new Response('not json', { status: 502, statusText: 'Bad Gateway' }));
    });
    const client = new CodaApiClient(config, fetchMock);
    await expect(
      client.listItems({
        entityTypeId,
        parentId: null,
        cursor: 'next/page',
        search: 'quiet signal',
        limit: 10,
        sort: 'title',
        direction: 'desc',
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    const failingClient = new CodaApiClient(config, () =>
      Promise.resolve(new Response('not json', { status: 502, statusText: 'Bad Gateway' })),
    );
    await expect(failingClient.context()).rejects.toMatchObject({
      status: 502,
      title: 'Bad Gateway',
    });
  });
});
