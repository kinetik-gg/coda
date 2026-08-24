import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CodaApiError } from './api-client.js';
import type { CodaApiClient } from './api-client.js';
import {
  activityListInputSchema,
  itemCreateInputSchema,
  itemListInputSchema,
  itemUpdateInputSchema,
  trackerItemCreateInputSchema,
  trackerItemListInputSchema,
  trackerItemUpdateInputSchema,
} from './schemas.js';

function successfulResult(value: unknown): CallToolResult {
  const structuredContent =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { data: value };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message =
    error instanceof CodaApiError
      ? error.publicMessage()
      : 'Coda MCP tool failed because a response or input did not match the expected shape.';
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function execute(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return successfulResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}

function readOnlyAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
}

function writeAnnotations() {
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
}

function registerProjectTools(server: McpServer, client: CodaApiClient): void {
  server.registerTool(
    'projects.get',
    {
      title: 'Get project',
      description: 'Get the project bound to this MCP token without member or role details.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    () => execute(() => client.getProject()),
  );

  server.registerTool(
    'schema.get',
    {
      title: 'Get project schema',
      description: 'Get hierarchy levels, custom fields, and field options for the bound project.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    () => execute(() => client.getSchema()),
  );

  server.registerTool(
    'items.list',
    {
      title: 'List items',
      description: 'List one bounded page of active items in the bound project.',
      inputSchema: itemListInputSchema.shape,
      annotations: readOnlyAnnotations(),
    },
    (input) => execute(() => client.listItems(itemListInputSchema.parse(input))),
  );

  server.registerTool(
    'items.create',
    {
      title: 'Create item',
      description: 'Create one item in the bound project using an existing hierarchy level.',
      inputSchema: itemCreateInputSchema.shape,
      annotations: writeAnnotations(),
    },
    (input) => execute(() => client.createItem(itemCreateInputSchema.parse(input))),
  );

  server.registerTool(
    'items.update',
    {
      title: 'Update item',
      description: 'Update one active item using its optimistic-concurrency version.',
      inputSchema: itemUpdateInputSchema.shape,
      annotations: writeAnnotations(),
    },
    (input) => execute(() => client.updateItem(itemUpdateInputSchema.parse(input))),
  );

  server.registerTool(
    'source.get',
    {
      title: 'Get source document',
      description: 'Get safe metadata for the source document attached to the bound project.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    () => execute(() => client.getSource()),
  );

  server.registerTool(
    'activity.list',
    {
      title: 'List activity',
      description: 'List up to 100 recent activity events in the bound project.',
      inputSchema: activityListInputSchema.shape,
      annotations: readOnlyAnnotations(),
    },
    (input) => {
      const parsed = activityListInputSchema.parse(input);
      return execute(() => client.listActivity(parsed.cursor));
    },
  );
}

function registerTrackerTools(server: McpServer, client: CodaApiClient): void {
  server.registerTool(
    'trackers.get',
    {
      title: 'Get tracker',
      description: 'Get the tracker bound to this MCP token without member or role details.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    () => execute(() => client.getTracker()),
  );

  server.registerTool(
    'tracker.schema.get',
    {
      title: 'Get tracker schema',
      description: 'Get the field definitions and options of the bound tracker.',
      inputSchema: {},
      annotations: readOnlyAnnotations(),
    },
    () => execute(() => client.getTrackerSchema()),
  );

  server.registerTool(
    'tracker.items.list',
    {
      title: 'List tracker records',
      description: 'List one bounded page of active records in the bound tracker.',
      inputSchema: trackerItemListInputSchema.shape,
      annotations: readOnlyAnnotations(),
    },
    (input) => execute(() => client.listTrackerItems(trackerItemListInputSchema.parse(input))),
  );

  server.registerTool(
    'tracker.items.create',
    {
      title: 'Create tracker record',
      description: 'Create one record in the bound tracker.',
      inputSchema: trackerItemCreateInputSchema.shape,
      annotations: writeAnnotations(),
    },
    (input) => execute(() => client.createTrackerItem(trackerItemCreateInputSchema.parse(input))),
  );

  server.registerTool(
    'tracker.items.update',
    {
      title: 'Update tracker record',
      description: 'Update one active record using its optimistic-concurrency version.',
      inputSchema: trackerItemUpdateInputSchema.shape,
      annotations: writeAnnotations(),
    },
    (input) => execute(() => client.updateTrackerItem(trackerItemUpdateInputSchema.parse(input))),
  );

  server.registerTool(
    'tracker.activity.list',
    {
      title: 'List tracker activity',
      description: 'List up to 100 recent activity events in the bound tracker.',
      inputSchema: activityListInputSchema.shape,
      annotations: readOnlyAnnotations(),
    },
    (input) => {
      const parsed = activityListInputSchema.parse(input);
      return execute(() => client.listTrackerActivity(parsed.cursor));
    },
  );
}

export async function createMcpServer(client: CodaApiClient): Promise<McpServer> {
  const server = new McpServer({ name: 'coda', version: '0.0.2' });
  const context = await client.context();
  if (context.resourceType === 'project') {
    registerProjectTools(server, client);
  } else {
    registerTrackerTools(server, client);
  }
  return server;
}
