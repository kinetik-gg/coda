import { describe, expect, it } from 'vitest';

const baseUrl = process.env.CODA_INTEGRATION_URL ?? 'http://127.0.0.1:3000';
const setupToken = process.env.CODA_INTEGRATION_SETUP_TOKEN;
const email = process.env.CODA_INTEGRATION_EMAIL;
const password = process.env.CODA_INTEGRATION_PASSWORD;

type JsonEnvelope<T> = { data: T };

function cookiesFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

function cookieValue(cookies: string, name: string): string {
  const match = cookies.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  if (!match?.[1]) throw new Error(`Expected ${name} cookie`);
  return decodeURIComponent(match[1]);
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

describe('Coda API with disposable Postgres and object storage', () => {
  it('completes setup, session, project, hierarchy, and item persistence', async () => {
    if (!setupToken || !email || !password) {
      throw new Error('Integration test credentials and setup token are required');
    }

    const readiness = await fetch(`${baseUrl}/api/v1/health/ready`);
    expect(readiness.status).toBe(200);

    const setupStatus = await json<JsonEnvelope<{ initialized: boolean }>>(
      await fetch(`${baseUrl}/api/v1/setup/status`),
    );
    expect(setupStatus.data.initialized).toBe(false);

    const invalidSetup = await fetch(`${baseUrl}/api/v1/setup/owner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-coda-setup-token': 'wrong-token' },
      body: JSON.stringify({ displayName: 'Integration Owner', email, password }),
    });
    expect(invalidSetup.status).toBe(401);

    const setupRequest = () =>
      fetch(`${baseUrl}/api/v1/setup/owner`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-coda-setup-token': setupToken,
        },
        body: JSON.stringify({ displayName: 'Integration Owner', email, password }),
      });
    const setupAttempts = await Promise.all([setupRequest(), setupRequest()]);
    expect(setupAttempts.map(({ status }) => status).sort()).toEqual([201, 409]);
    const setup = setupAttempts.find(({ status }) => status === 201);
    if (!setup) throw new Error('Expected one successful setup request');
    const cookies = cookiesFrom(setup);
    const csrf = cookieValue(cookies, 'coda_csrf');
    expect(cookies).toContain('coda_session=');

    const authenticatedHeaders = {
      'content-type': 'application/json',
      cookie: cookies,
      'x-coda-csrf': csrf,
    };
    const session = await json<JsonEnvelope<{ email: string }>>(
      await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { cookie: cookies } }),
    );
    expect(session.data.email).toBe(email);

    const created = await json<JsonEnvelope<{ id: string }>>(
      await fetch(`${baseUrl}/api/v1/projects/from-template`, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({
          name: 'Integration Project',
          description: 'Disposable system-test workspace',
          templateId: 'movie',
        }),
      }),
    );
    expect(created.data.id).toMatch(/^[0-9a-f-]{36}$/i);

    const project = await json<
      JsonEnvelope<{ id: string; entityTypes: Array<{ id: string; pluralName: string }> }>
    >(
      await fetch(`${baseUrl}/api/v1/projects/${created.data.id}`, {
        headers: { cookie: cookies },
      }),
    );
    expect(project.data.entityTypes.map((entry) => entry.pluralName)).toEqual([
      'Sequences',
      'Scenes',
      'Shots',
    ]);

    const item = await json<JsonEnvelope<{ id: string; title: string; version: number }>>(
      await fetch(`${baseUrl}/api/v1/projects/${created.data.id}/items`, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({
          entityTypeId: project.data.entityTypes[0]?.id,
          title: 'Opening sequence',
        }),
      }),
    );
    expect(item.data.title).toBe('Opening sequence');

    const listed = await json<JsonEnvelope<Array<{ id: string; title: string }>>>(
      await fetch(
        `${baseUrl}/api/v1/projects/${created.data.id}/items?entityTypeId=${project.data.entityTypes[0]?.id}&limit=25&sort=manual&direction=asc`,
        { headers: { cookie: cookies } },
      ),
    );
    expect(listed.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: item.data.id, title: item.data.title }),
      ]),
    );

    const staleUpdate = await fetch(
      `${baseUrl}/api/v1/projects/${created.data.id}/items/${item.data.id}`,
      {
        method: 'PATCH',
        headers: authenticatedHeaders,
        body: JSON.stringify({ title: 'Stale title', version: item.data.version + 10 }),
      },
    );
    expect(staleUpdate.status).toBe(409);

    const credential = await json<JsonEnvelope<{ token: string }>>(
      await fetch(`${baseUrl}/api/v1/account/credentials`, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({
          projectId: created.data.id,
          name: 'Integration API key',
          kind: 'api_key',
          permissions: ['read_project'],
        }),
      }),
    );
    const bearerHeaders = { authorization: `Bearer ${credential.data.token}` };
    const tokenContext = await json<JsonEnvelope<{ projectId: string }>>(
      await fetch(`${baseUrl}/api/v1/token/context`, { headers: bearerHeaders }),
    );
    expect(tokenContext.data.projectId).toBe(created.data.id);
    const blockedAccount = await fetch(`${baseUrl}/api/v1/account`, { headers: bearerHeaders });
    expect(blockedAccount.status).toBe(403);
    const hiddenProject = await fetch(
      `${baseUrl}/api/v1/projects/90000000-0000-4000-8000-000000000009/items`,
      { headers: bearerHeaders },
    );
    expect(hiddenProject.status).toBe(404);
  });
});
