import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodaApiClient, CodaApiError } from './api-client.js';
import { createMcpServer } from './server.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const trackerId = '99999999-9999-4999-8999-999999999999';
const token = `coda_mcp_${'a'.repeat(43)}`;

function requestUrl(input: URL | RequestInfo): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function contextResponse(resourceType: 'project' | 'tracker'): Response {
  const data =
    resourceType === 'project'
      ? { resourceType, projectId, kind: 'MCP_TOKEN', permissions: ['read_project'] }
      : { resourceType, trackerId, kind: 'MCP_TOKEN', permissions: ['read_tracker'] };
  return new Response(JSON.stringify({ data }), {
    headers: { 'content-type': 'application/json' },
  });
}

async function connect(api: CodaApiClient): Promise<Client> {
  const server = await createMcpServer(api);
  const protocolClient = new Client({ name: 'coda-mcp-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), protocolClient.connect(clientTransport)]);
  return protocolClient;
}

describe('Coda MCP protocol', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it('publishes only the bounded project surface to a project-bound token', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (requestUrl(input).endsWith('/api/v1/token/context')) {
        return Promise.resolve(contextResponse('project'));
      }
      return Promise.reject(new Error(`Unexpected test request: ${requestUrl(input)}`));
    });
    const api = new CodaApiClient(
      { apiOrigin: 'https://coda.example', token, timeoutMs: 1_000 },
      fetchMock,
    );
    const protocolClient = await connect(api);
    clients.push(protocolClient);

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

  it('publishes only the tracker tools to a tracker-bound token', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (requestUrl(input).endsWith('/api/v1/token/context')) {
        return Promise.resolve(contextResponse('tracker'));
      }
      return Promise.reject(new Error(`Unexpected test request: ${requestUrl(input)}`));
    });
    const api = new CodaApiClient(
      { apiOrigin: 'https://coda.example', token, timeoutMs: 1_000 },
      fetchMock,
    );
    const protocolClient = await connect(api);
    clients.push(protocolClient);

    const { tools } = await protocolClient.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      'trackers.get',
      'tracker.schema.get',
      'tracker.items.list',
      'tracker.items.create',
      'tracker.items.update',
      'tracker.activity.list',
    ]);
    expect(tools.map(({ name }) => name)).not.toContain('projects.get');
    expect(tools.map(({ name }) => name)).not.toContain('items.create');
    expect(tools.map(({ name }) => name)).not.toContain('trackers.delete');
  });

  it('validates and dispatches every published project operation', async () => {
    const entityTypeId = '22222222-2222-4222-8222-222222222222';
    const itemId = '33333333-3333-4333-8333-333333333333';
    const activityCursor = '44444444-4444-4444-8444-444444444444';
    const api = {
      context: vi.fn().mockResolvedValue({
        resourceType: 'project',
        projectId,
        kind: 'MCP_TOKEN',
        permissions: ['read_project'],
      }),
      getProject: vi.fn().mockResolvedValue({ id: projectId }),
      getSchema: vi.fn().mockResolvedValue({ projectId, levels: [] }),
      listItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      createItem: vi.fn().mockResolvedValue({ id: itemId }),
      updateItem: vi.fn().mockResolvedValue({ id: itemId, version: 2 }),
      getSource: vi.fn().mockResolvedValue({ projectId, documents: [] }),
      listActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    };
    const protocolClient = await connect(api as unknown as CodaApiClient);
    clients.push(protocolClient);

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

    expect(api.context).toHaveBeenCalledOnce();
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

  it('validates and dispatches every published tracker operation', async () => {
    const fieldId = '55555555-5555-4555-8555-555555555555';
    const recordId = '66666666-6666-4666-8666-666666666666';
    const activityCursor = '77777777-7777-4777-8777-777777777777';
    const api = {
      context: vi.fn().mockResolvedValue({
        resourceType: 'tracker',
        trackerId,
        kind: 'MCP_TOKEN',
        permissions: ['read_tracker'],
      }),
      getTracker: vi.fn().mockResolvedValue({ id: trackerId }),
      getTrackerSchema: vi.fn().mockResolvedValue({ trackerId, revision: 3, fields: [] }),
      listTrackerItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      createTrackerItem: vi.fn().mockResolvedValue({ id: recordId, version: 1 }),
      updateTrackerItem: vi.fn().mockResolvedValue({ id: recordId, version: 2 }),
      listTrackerActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    };
    const protocolClient = await connect(api as unknown as CodaApiClient);
    clients.push(protocolClient);

    await protocolClient.callTool({ name: 'trackers.get', arguments: {} });
    await protocolClient.callTool({ name: 'tracker.schema.get', arguments: {} });
    await protocolClient.callTool({
      name: 'tracker.items.list',
      arguments: {
        limit: 25,
        sort: 'title',
        direction: 'desc',
        search: 'dune',
        filters: [{ fieldId, operator: 'is_empty' }],
      },
    });
    await protocolClient.callTool({
      name: 'tracker.items.create',
      arguments: { title: 'Example record' },
    });
    await protocolClient.callTool({
      name: 'tracker.items.update',
      arguments: { itemId: recordId, version: 1, title: 'Updated record' },
    });
    const activity = await protocolClient.callTool({
      name: 'tracker.activity.list',
      arguments: { cursor: activityCursor },
    });

    expect(api.context).toHaveBeenCalledOnce();
    expect(api.getTracker).toHaveBeenCalledOnce();
    expect(api.getTrackerSchema).toHaveBeenCalledOnce();
    expect(api.listTrackerItems).toHaveBeenCalledWith({
      limit: 25,
      sort: 'title',
      direction: 'desc',
      search: 'dune',
      filters: [{ fieldId, operator: 'is_empty' }],
    });
    expect(api.createTrackerItem).toHaveBeenCalledWith({ title: 'Example record' });
    expect(api.updateTrackerItem).toHaveBeenCalledWith({
      itemId: recordId,
      version: 1,
      title: 'Updated record',
    });
    expect(api.listTrackerActivity).toHaveBeenCalledWith(activityCursor);
    expect(activity.structuredContent).toEqual({ events: [], nextCursor: null });
  });

  it('returns public API failures as MCP tool errors on the tracker surface', async () => {
    const api = {
      context: vi.fn().mockResolvedValue({
        resourceType: 'tracker',
        trackerId,
        kind: 'MCP_TOKEN',
        permissions: [],
      }),
      getTracker: vi
        .fn()
        .mockRejectedValueOnce(new CodaApiError(409, 'Conflict', 'Refresh and retry'))
        .mockRejectedValueOnce(new Error('malformed response')),
    };
    const protocolClient = await connect(api as unknown as CodaApiClient);
    clients.push(protocolClient);

    const result = await protocolClient.callTool({ name: 'trackers.get', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Refresh and retry');

    const shapeResult = await protocolClient.callTool({ name: 'trackers.get', arguments: {} });
    expect(shapeResult.isError).toBe(true);
    expect(JSON.stringify(shapeResult)).toContain('did not match the expected shape');
  });
});
