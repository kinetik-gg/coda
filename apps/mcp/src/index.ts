#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CodaApiClient } from './api-client.js';
import { readConfig } from './config.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const client = new CodaApiClient(readConfig());
  await client.context();
  const server = createMcpServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  console.error('Coda MCP server could not start. Check its API URL and MCP token.');
  process.exitCode = 1;
});
