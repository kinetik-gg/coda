import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CodaApiError } from './api-client.js';
import type { CodaApiClient } from './api-client.js';
import {
  activityListInputSchema,
  itemCreateInputSchema,
  itemListInputSchema,
  itemUpdateInputSchema,
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

export function createMcpServer(client: CodaApiClient): McpServer {
  const server = new McpServer({ name: 'coda', version: '0.0.1' });

  server.registerTool(
    'projects.get',
    {
      title: 'Get project',
      description: 'Get the project bound to this MCP token without member or role details.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    () => execute(() => client.getProject()),
  );

  server.registerTool(
    'schema.get',
    {
      title: 'Get project schema',
      description: 'Get hierarchy levels, custom fields, and field options for the bound project.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    () => execute(() => client.getSchema()),
  );

  server.registerTool(
    'items.list',
    {
      title: 'List items',
      description: 'List one bounded page of active items in the bound project.',
      inputSchema: itemListInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    (input) => execute(() => client.listItems(itemListInputSchema.parse(input))),
  );

  server.registerTool(
    'items.create',
    {
      title: 'Create item',
      description: 'Create one item in the bound project using an existing hierarchy level.',
      inputSchema: itemCreateInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => execute(() => client.createItem(itemCreateInputSchema.parse(input))),
  );

  server.registerTool(
    'items.update',
    {
      title: 'Update item',
      description: 'Update one active item using its optimistic-concurrency version.',
      inputSchema: itemUpdateInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => execute(() => client.updateItem(itemUpdateInputSchema.parse(input))),
  );

  server.registerTool(
    'source.get',
    {
      title: 'Get source document',
      description: 'Get safe metadata for the source document attached to the bound project.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    () => execute(() => client.getSource()),
  );

  server.registerTool(
    'activity.list',
    {
      title: 'List activity',
      description: 'List up to 100 recent activity events in the bound project.',
      inputSchema: activityListInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    (input) => {
      const parsed = activityListInputSchema.parse(input);
      return execute(() => client.listActivity(parsed.cursor));
    },
  );

  return server;
}
