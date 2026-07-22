import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodaApiClient, CodaApiError } from './api-client.js';
import { createMcpServer } from './server.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const token = `coda_mcp_${'a'.repeat(43)}`;

function requestUrl(input: URL | RequestInfo): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

describe('Coda MCP protocol', () => {
  const transports: InMemoryTransport[] = [];

  afterEach(async () => {
    await Promise.all(transports.splice(0).map((transport) => transport.close()));
  });

  it('publishes only the bounded, non-destructive tool surface', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (requestUrl(input).endsWith('/api/v1/token/context')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: { projectId, kind: 'MCP_TOKEN', permissions: ['read_project'] },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected test request: ${requestUrl(input)}`));
    });
    const api = new CodaApiClient(
      { apiOrigin: 'https://coda.example', token, timeoutMs: 1_000 },
      fetchMock,
    );
    const server = createMcpServer(api);
    const protocolClient = new Client({ name: 'coda-mcp-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    transports.push(clientTransport, serverTransport);
    await Promise.all([server.connect(serverTransport), protocolClient.connect(clientTransport)]);

    const { tools } = await protocolClient.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      'projects.get',
      'schema.get',
      'items.list',
      'items.create',
      'items.update',
      'source.get',
      'activity.list',
    ]);
    expect(tools.map(({ name }) => name)).not.toContain('projects.list');
    expect(tools.map(({ name }) => name)).not.toContain('source_references.set');
  });

  it('validates and dispatches every published operation', async () => {
    const entityTypeId = '22222222-2222-4222-8222-222222222222';
    const itemId = '33333333-3333-4333-8333-333333333333';
    const activityCursor = '44444444-4444-4444-8444-444444444444';
    const api = {
      getProject: vi.fn().mockResolvedValue({ id: projectId }),
      getSchema: vi.fn().mockResolvedValue({ projectId, levels: [] }),
      listItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      createItem: vi.fn().mockResolvedValue({ id: itemId }),
      updateItem: vi.fn().mockResolvedValue({ id: itemId, version: 2 }),
      getSource: vi.fn().mockResolvedValue({ projectId, documents: [] }),
      listActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    };
    const server = createMcpServer(api as unknown as CodaApiClient);
    const protocolClient = new Client({ name: 'coda-mcp-dispatch-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    transports.push(clientTransport, serverTransport);
    await Promise.all([server.connect(serverTransport), protocolClient.connect(clientTransport)]);

    await protocolClient.callTool({ name: 'projects.get', arguments: {} });
    await protocolClient.callTool({ name: 'schema.get', arguments: {} });
    await protocolClient.callTool({
      name: 'items.list',
      arguments: { entityTypeId, limit: 25, sort: 'manual', direction: 'asc' },
    });
    await protocolClient.callTool({
      name: 'items.create',
      arguments: { entityTypeId, title: 'Example item' },
    });
    await protocolClient.callTool({
      name: 'items.update',
      arguments: { itemId, version: 1, title: 'Updated item' },
    });
    await protocolClient.callTool({ name: 'source.get', arguments: {} });
    const activity = await protocolClient.callTool({
      name: 'activity.list',
      arguments: { cursor: activityCursor },
    });

    expect(api.getProject).toHaveBeenCalledOnce();
    expect(api.getSchema).toHaveBeenCalledOnce();
    expect(api.listItems).toHaveBeenCalledWith({
      entityTypeId,
      limit: 25,
      sort: 'manual',
      direction: 'asc',
    });
    expect(api.createItem).toHaveBeenCalledWith({ entityTypeId, title: 'Example item' });
    expect(api.updateItem).toHaveBeenCalledWith({ itemId, version: 1, title: 'Updated item' });
    expect(api.getSource).toHaveBeenCalledOnce();
    expect(api.listActivity).toHaveBeenCalledWith(activityCursor);
    expect(activity.structuredContent).toEqual({ events: [], nextCursor: null });
  });

  it('returns public API failures as MCP tool errors', async () => {
    const api = {
      getProject: vi.fn().mockRejectedValue(new CodaApiError(409, 'Conflict', 'Refresh and retry')),
    };
    const server = createMcpServer(api as unknown as CodaApiClient);
    const protocolClient = new Client({ name: 'coda-mcp-error-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    transports.push(clientTransport, serverTransport);
    await Promise.all([server.connect(serverTransport), protocolClient.connect(clientTransport)]);

    const result = await protocolClient.callTool({ name: 'projects.get', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Refresh and retry');
  });
});
