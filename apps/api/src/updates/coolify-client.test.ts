import { describe, expect, it, vi } from 'vitest';
import { CODA_IMAGE_ENV_KEY, CoolifyApiError, CoolifyClient } from './coolify-client';

const TOKEN = 'fixture-coolify-token-not-a-secret';

const config = {
  baseUrl: 'https://coolify.example/',
  apiToken: TOKEN,
  applicationUuid: 'app-uuid-1234',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CoolifyClient', () => {
  it('PATCHes CODA_IMAGE with a bearer token and a trimmed base URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new CoolifyClient(config, { fetchImpl });

    await client.setImageEnv('ghcr.io/kinetik-gg/coda@sha256:abc');

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://coolify.example/api/v1/applications/app-uuid-1234/envs');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.key).toBe(CODA_IMAGE_ENV_KEY);
    expect(body.value).toBe('ghcr.io/kinetik-gg/coda@sha256:abc');
    expect(body.is_preview).toBe(false);
  });

  it('triggers a deploy and returns the deployment uuid', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ deployments: [{ deployment_uuid: 'dep-1' }] }));
    const client = new CoolifyClient(config, { fetchImpl });

    const result = await client.deploy();

    expect(result.deploymentUuid).toBe('dep-1');
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://coolify.example/api/v1/deploy?uuid=app-uuid-1234');
    expect(init.method).toBe('POST');
  });

  it('returns a null deployment uuid when Coolify reports none', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new CoolifyClient(config, { fetchImpl });
    await expect(client.deploy()).resolves.toEqual({ deploymentUuid: null });
  });

  it('never leaks the token in an HTTP error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'forbidden' }, 403));
    const client = new CoolifyClient(config, { fetchImpl });

    const error = await client.setImageEnv('image@sha256:abc').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoolifyApiError);
    expect((error as CoolifyApiError).status).toBe(403);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).toContain('403');
  });

  it('never leaks the token when the request throws at the transport layer', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new CoolifyClient(config, { fetchImpl });

    const error = await client.deploy().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoolifyApiError);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).toContain('ECONNREFUSED');
  });

  it('aborts and reports a timeout when the request exceeds the bound', async () => {
    const fetchImpl = vi.fn((_, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });
    const client = new CoolifyClient(config, { fetchImpl, timeoutMs: 5 });

    const error = await client.deploy().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoolifyApiError);
    expect((error as Error).message).toContain('timed out');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
