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
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['http://127.1:3000', 'http://127.0.0.1:3000'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
  ])('accepts HTTP only for loopback origin %s', (apiUrl, apiOrigin) => {
    expect(readConfig({ CODA_API_URL: apiUrl, CODA_MCP_TOKEN: validToken })).toEqual({
      apiOrigin,
      token: validToken,
      timeoutMs: 10_000,
    });
  });

  it.each([
    'file:///tmp/data',
    'https://user:pass@coda.example',
    'https://coda.example/api',
    'https://coda.example/?target=other',
    'http://coda.example',
    'http://192.168.1.20:3000',
    'http://localhost.example:3000',
    'http://127.example.test:3000',
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
