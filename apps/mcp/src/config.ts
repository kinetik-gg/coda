import { z } from 'zod';

const rawConfigSchema = z.object({
  CODA_API_URL: z.string().url().default('http://127.0.0.1:3000'),
  CODA_MCP_TOKEN: z.string().regex(/^coda_mcp_[A-Za-z0-9_-]{32,}$/),
  CODA_MCP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
});

export interface McpConfig {
  apiOrigin: string;
  token: string;
  timeoutMs: number;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): McpConfig {
  const raw = rawConfigSchema.parse(environment);
  const apiUrl = new URL(raw.CODA_API_URL);
  if (
    !['http:', 'https:'].includes(apiUrl.protocol) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash ||
    (apiUrl.pathname !== '/' && apiUrl.pathname !== '')
  ) {
    throw new Error('CODA_API_URL must be an HTTP(S) origin without credentials or a path');
  }
  return {
    apiOrigin: apiUrl.origin,
    token: raw.CODA_MCP_TOKEN,
    timeoutMs: raw.CODA_MCP_TIMEOUT_MS,
  };
}
