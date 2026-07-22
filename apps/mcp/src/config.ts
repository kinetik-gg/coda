import { z } from 'zod';

const rawConfigSchema = z.object({
  CODA_API_URL: z.string().url().default('http://127.0.0.1:3000'),
  CODA_MCP_TOKEN: z.string().regex(/^coda_mcp_[A-Za-z0-9_-]{32,}$/),
  CODA_MCP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
});

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

export interface McpConfig {
  apiOrigin: string;
  token: string;
  timeoutMs: number;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): McpConfig {
  const raw = rawConfigSchema.parse(environment);
  const apiUrl = new URL(raw.CODA_API_URL);
  if (
    (apiUrl.protocol !== 'https:' &&
      !(apiUrl.protocol === 'http:' && isLoopbackHostname(apiUrl.hostname))) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash ||
    (apiUrl.pathname !== '/' && apiUrl.pathname !== '')
  ) {
    throw new Error(
      'CODA_API_URL must be an HTTPS origin (or an HTTP loopback origin) without credentials or a path',
    );
  }
  return {
    apiOrigin: apiUrl.origin,
    token: raw.CODA_MCP_TOKEN,
    timeoutMs: raw.CODA_MCP_TIMEOUT_MS,
  };
}
