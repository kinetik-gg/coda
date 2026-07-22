import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const validToken = `coda_mcp_${'x'.repeat(43)}`;

describe('readConfig', () => {
  it('accepts a plain API origin and bounded timeout', () => {
    expect(
      readConfig({
        CODA_API_URL: 'https://coda.example/',
        CODA_MCP_TOKEN: validToken,
        CODA_MCP_TIMEOUT_MS: '5000',
      }),
    ).toEqual({ apiOrigin: 'https://coda.example', token: validToken, timeoutMs: 5_000 });
  });

  it.each([
    'file:///tmp/data',
    'https://user:pass@coda.example',
    'https://coda.example/api',
    'https://coda.example/?target=other',
  ])('rejects unsafe API URL %s', (apiUrl) => {
    expect(() => readConfig({ CODA_API_URL: apiUrl, CODA_MCP_TOKEN: validToken })).toThrow();
  });

  it('rejects credentials for another audience', () => {
    expect(() =>
      readConfig({
        CODA_API_URL: 'https://coda.example',
        CODA_MCP_TOKEN: `coda_api_${'x'.repeat(43)}`,
      }),
    ).toThrow();
  });
});
