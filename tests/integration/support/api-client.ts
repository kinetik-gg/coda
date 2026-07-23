import { expect } from 'vitest';

export const baseUrl = process.env.CODA_INTEGRATION_URL ?? 'http://127.0.0.1:3000';
export const setupToken = process.env.CODA_INTEGRATION_SETUP_TOKEN;
export const ownerEmail = process.env.CODA_INTEGRATION_EMAIL;
export const ownerPassword = process.env.CODA_INTEGRATION_PASSWORD;
export const memberPassword = 'IntegrationMember2026';

export type JsonEnvelope<T> = { data: T; meta?: Record<string, unknown> };
export type SessionAuth = { cookies: string; csrf: string };
export type EntityType = { id: string; pluralName: string };
export type Role = { id: string; name: string; isOwner: boolean };
export type Project = {
  id: string;
  name: string;
  version: number;
  entityTypes: EntityType[];
  roles: Role[];
};
export type Item = {
  id: string;
  title: string;
  version: number;
  position: string;
  values: Array<{ fieldId: string; textValue: string | null }>;
  sourceReferences: Array<{ sourceDocumentId: string; startPage: number; endPage: number }>;
};

export function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function cookiesFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return (headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

function cookieValue(cookies: string, name: string): string {
  const match = cookies.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  if (!match?.[1]) throw new Error(`Expected ${name} cookie`);
  return decodeURIComponent(match[1]);
}

export function authFrom(response: Response): SessionAuth {
  const cookies = cookiesFrom(response);
  return { cookies, csrf: cookieValue(cookies, 'coda_csrf') };
}

function requestHeaders(auth?: SessionAuth, body?: BodyInit | null): Headers {
  const headers = new Headers();
  if (body) headers.set('content-type', 'application/json');
  if (auth) {
    headers.set('cookie', auth.cookies);
    headers.set('x-coda-csrf', auth.csrf);
  }
  return headers;
}

export async function request(
  path: string,
  init: RequestInit = {},
  auth?: SessionAuth,
): Promise<Response> {
  const headers = requestHeaders(auth, init.body);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

export async function responseJson<T>(response: Response, expectedStatus: number): Promise<T> {
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`HTTP ${response.status}, expected ${expectedStatus}: ${text}`);
  }
  return JSON.parse(text) as T;
}

export async function api<T>(
  path: string,
  expectedStatus: number,
  init: RequestInit = {},
  auth?: SessionAuth,
): Promise<T> {
  return responseJson<T>(await request(path, init, auth), expectedStatus);
}

export function tokenFromInvitationUrl(invitationUrl: string): string {
  return required(
    new URL(invitationUrl, baseUrl).searchParams.get('token'),
    'Invitation response did not contain a token',
  );
}

let uniqueCounter = 0;

export function uniqueEmail(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uniqueCounter}@coda.local`;
}

export function onePagePdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let content = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content, 'ascii'));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content, 'ascii');
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content, 'ascii');
}

/**
 * The owner account is a singleton for the whole running stack, so it is created (or, for a
 * re-used stack, logged in) exactly once and shared across every scenario. Only the running
 * stack is shared; each scenario still provisions its own projects, items, and members.
 */
let cachedOwner: SessionAuth | undefined;

export function setCachedOwnerAuth(auth: SessionAuth): void {
  cachedOwner = auth;
}

export async function ensureOwnerAuth(): Promise<SessionAuth> {
  if (cachedOwner) return cachedOwner;
  if (!setupToken || !ownerEmail || !ownerPassword) {
    throw new Error('Integration test credentials and setup token are required');
  }
  const status = await api<JsonEnvelope<{ initialized: boolean }>>('/api/v1/setup/status', 200);
  if (status.data.initialized) {
    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    });
    await responseJson(login, 200);
    cachedOwner = authFrom(login);
  } else {
    const created = await request('/api/v1/setup/owner', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Integration Owner',
        email: ownerEmail,
        password: ownerPassword,
      }),
      headers: { 'x-coda-setup-token': setupToken },
    });
    await responseJson(created, 201);
    cachedOwner = authFrom(created);
  }
  return cachedOwner;
}

export async function provisionMovieProject(auth: SessionAuth): Promise<Project> {
  const created = await api<JsonEnvelope<{ id: string }>>(
    '/api/v1/projects/from-template',
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Integration Project',
        description: 'Disposable system-test workspace',
        templateId: 'movie',
      }),
    },
    auth,
  );
  const project = await api<JsonEnvelope<Project>>(
    `/api/v1/projects/${created.data.id}`,
    200,
    {},
    auth,
  );
  return project.data;
}

export async function createItem(
  auth: SessionAuth,
  projectId: string,
  entityTypeId: string,
  title: string,
): Promise<Item> {
  const result = await api<JsonEnvelope<Item>>(
    `/api/v1/projects/${projectId}/items`,
    201,
    { method: 'POST', body: JSON.stringify({ entityTypeId, title }) },
    auth,
  );
  return result.data;
}

export async function listItems(
  auth: SessionAuth,
  projectId: string,
  entityTypeId: string,
): Promise<Item[]> {
  const result = await api<JsonEnvelope<Item[]>>(
    `/api/v1/projects/${projectId}/items?entityTypeId=${entityTypeId}&limit=25&sort=manual&direction=asc`,
    200,
    {},
    auth,
  );
  return result.data;
}

export async function createTextField(
  auth: SessionAuth,
  projectId: string,
  entityTypeId: string,
): Promise<string> {
  const field = await api<JsonEnvelope<{ id: string }>>(
    `/api/v1/projects/${projectId}/fields`,
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        entityTypeId,
        name: 'Editorial note',
        key: 'editorial_note',
        type: 'text',
        required: false,
      }),
    },
    auth,
  );
  return field.data.id;
}

/**
 * Provisions a movie project with one item carrying a single text field value, matching the
 * fixture the storage/export scenario relies on ("Editorial note" -> "Hold on the final frame").
 */
export async function provisionExportFixture(
  auth: SessionAuth,
): Promise<{ project: Project; entityTypeId: string; itemId: string; fieldId: string }> {
  const project = await provisionMovieProject(auth);
  const entityTypeId = required(project.entityTypes[0]?.id, 'Movie template has no root level');
  const item = await createItem(auth, project.id, entityTypeId, 'Opening sequence');
  const fieldId = await createTextField(auth, project.id, entityTypeId);
  await api<JsonEnvelope<Item>>(
    `/api/v1/projects/${project.id}/items/${item.id}/fields/${fieldId}`,
    200,
    {
      method: 'PUT',
      body: JSON.stringify({
        value: { type: 'text', value: 'Hold on the final frame' },
        itemVersion: item.version,
      }),
    },
    auth,
  );
  return { project, entityTypeId, itemId: item.id, fieldId };
}

export async function createViewerInvitation(
  auth: SessionAuth,
  project: Project,
  email: string,
): Promise<string> {
  const viewer = required(
    project.roles.find(({ name, isOwner }) => name === 'viewer' && !isOwner),
    'Project has no viewer role',
  );
  const invitation = await api<JsonEnvelope<{ invitationUrl: string }>>(
    `/api/v1/projects/${project.id}/invitations`,
    201,
    { method: 'POST', body: JSON.stringify({ email, roleId: viewer.id }) },
    auth,
  );
  return tokenFromInvitationUrl(invitation.data.invitationUrl);
}

export async function acceptInvitation(
  token: string,
  displayName: string,
): Promise<{ auth: SessionAuth; email: string }> {
  const accepted = await request('/api/v1/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token, displayName, password: memberPassword }),
  });
  const account = await responseJson<JsonEnvelope<{ email: string }>>(accepted, 201);
  return { auth: authFrom(accepted), email: account.data.email };
}

/**
 * Provisions a second, independent user by inviting a unique viewer to a throwaway project and
 * accepting the invitation. Used where a scenario only needs "some other authenticated account".
 */
export async function provisionMember(auth: SessionAuth): Promise<SessionAuth> {
  const project = await provisionMovieProject(auth);
  const token = await createViewerInvitation(auth, project, uniqueEmail('integration-other'));
  return (await acceptInvitation(token, 'Integration Other')).auth;
}

export function expectPrivateScreenplayResponse(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private,no-store');
  expect(
    response.headers
      .get('vary')
      ?.toLowerCase()
      .split(',')
      .map((value) => value.trim()),
  ).toContain('cookie');
}
