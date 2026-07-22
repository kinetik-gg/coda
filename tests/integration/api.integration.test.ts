import { describe, expect, it } from 'vitest';

const baseUrl = process.env.CODA_INTEGRATION_URL ?? 'http://127.0.0.1:3000';
const setupToken = process.env.CODA_INTEGRATION_SETUP_TOKEN;
const ownerEmail = process.env.CODA_INTEGRATION_EMAIL;
const ownerPassword = process.env.CODA_INTEGRATION_PASSWORD;
const memberEmail = 'integration-member@coda.local';
const memberPassword = 'IntegrationMember2026';

type JsonEnvelope<T> = { data: T; meta?: Record<string, unknown> };
type SessionAuth = { cookies: string; csrf: string };
type EntityType = { id: string; pluralName: string };
type Role = { id: string; name: string; isOwner: boolean };
type Project = {
  id: string;
  name: string;
  version: number;
  entityTypes: EntityType[];
  roles: Role[];
};
type Item = {
  id: string;
  title: string;
  version: number;
  position: string;
  values: Array<{ fieldId: string; textValue: string | null }>;
  sourceReferences: Array<{ sourceDocumentId: string; startPage: number; endPage: number }>;
};

function required<T>(value: T | null | undefined, message: string): T {
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

function authFrom(response: Response): SessionAuth {
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

async function request(
  path: string,
  init: RequestInit = {},
  auth?: SessionAuth,
): Promise<Response> {
  const headers = requestHeaders(auth, init.body);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function responseJson<T>(response: Response, expectedStatus: number): Promise<T> {
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`HTTP ${response.status}, expected ${expectedStatus}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function api<T>(
  path: string,
  expectedStatus: number,
  init: RequestInit = {},
  auth?: SessionAuth,
): Promise<T> {
  return responseJson<T>(await request(path, init, auth), expectedStatus);
}

function tokenFromInvitationUrl(invitationUrl: string): string {
  return required(
    new URL(invitationUrl, baseUrl).searchParams.get('token'),
    'Invitation response did not contain a token',
  );
}

function onePagePdf(): Uint8Array {
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

async function setupOwner(): Promise<SessionAuth> {
  if (!setupToken || !ownerEmail || !ownerPassword) {
    throw new Error('Integration test credentials and setup token are required');
  }
  expect((await request('/api/v1/health/ready')).status).toBe(200);
  const status = await api<JsonEnvelope<{ initialized: boolean }>>('/api/v1/setup/status', 200);
  expect(status.data.initialized).toBe(false);

  const invalid = await request('/api/v1/setup/owner', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Integration Owner',
      email: ownerEmail,
      password: ownerPassword,
    }),
    headers: { 'x-coda-setup-token': 'wrong-token' },
  });
  expect(invalid.status).toBe(401);

  const createOwner = () =>
    request('/api/v1/setup/owner', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Integration Owner',
        email: ownerEmail,
        password: ownerPassword,
      }),
      headers: { 'x-coda-setup-token': setupToken },
    });
  const attempts = await Promise.all([createOwner(), createOwner()]);
  expect(attempts.map(({ status: code }) => code).sort()).toEqual([201, 409]);
  const created = required(
    attempts.find(({ status: code }) => code === 201),
    'Expected exactly one successful setup request',
  );
  const auth = authFrom(created);
  const session = await api<JsonEnvelope<{ email: string }>>('/api/v1/auth/session', 200, {}, auth);
  expect(session.data.email).toBe(ownerEmail);
  return auth;
}

async function createMovieProject(auth: SessionAuth): Promise<Project> {
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
  expect(project.data.entityTypes.map(({ pluralName }) => pluralName)).toEqual([
    'Sequences',
    'Scenes',
    'Shots',
  ]);
  return project.data;
}

async function createItem(
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

async function listItems(
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

async function exerciseItemsAndFields(auth: SessionAuth, project: Project) {
  const entityTypeId = required(project.entityTypes[0]?.id, 'Movie template has no root level');
  const opening = await createItem(auth, project.id, entityTypeId, 'Opening sequence');
  const closing = await createItem(auth, project.id, entityTypeId, 'Closing sequence');

  const stale = await request(
    `/api/v1/projects/${project.id}/items/${opening.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Stale title', version: opening.version + 10 }),
    },
    auth,
  );
  expect(stale.status).toBe(409);

  await api<JsonEnvelope<Item>>(
    `/api/v1/projects/${project.id}/items/${closing.id}/reorder`,
    200,
    {
      method: 'PATCH',
      body: JSON.stringify({ beforeId: opening.id, parentId: null, version: closing.version }),
    },
    auth,
  );
  expect((await listItems(auth, project.id, entityTypeId)).slice(0, 2).map(({ id }) => id)).toEqual(
    [closing.id, opening.id],
  );

  const moverA = await createItem(auth, project.id, entityTypeId, 'Concurrent mover A');
  const moverB = await createItem(auth, project.id, entityTypeId, 'Concurrent mover B');
  const moveIntoSameGap = (item: Item) =>
    request(
      `/api/v1/projects/${project.id}/items/${item.id}/reorder`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          afterId: closing.id,
          beforeId: opening.id,
          parentId: null,
          version: item.version,
        }),
      },
      auth,
    );
  const concurrent = await Promise.all([moveIntoSameGap(moverA), moveIntoSameGap(moverB)]);
  expect(concurrent.map(({ status }) => status).sort()).toEqual([200, 400]);
  const reordered = await listItems(auth, project.id, entityTypeId);
  expect(new Set(reordered.map(({ position }) => position)).size).toBe(reordered.length);
  expect(reordered[0]?.id).toBe(closing.id);
  expect([moverA.id, moverB.id]).toContain(reordered[1]?.id);
  expect(reordered[2]?.id).toBe(opening.id);

  const field = await api<JsonEnvelope<{ id: string }>>(
    `/api/v1/projects/${project.id}/fields`,
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
  await api<JsonEnvelope<Item>>(
    `/api/v1/projects/${project.id}/items/${opening.id}/fields/${field.data.id}`,
    200,
    {
      method: 'PUT',
      body: JSON.stringify({
        value: { type: 'text', value: 'Hold on the final frame' },
        itemVersion: opening.version,
      }),
    },
    auth,
  );
  const persisted = required(
    (await listItems(auth, project.id, entityTypeId)).find(({ id }) => id === opening.id),
    'Opening item disappeared after field update',
  );
  expect(persisted.values).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ fieldId: field.data.id, textValue: 'Hold on the final frame' }),
    ]),
  );
  return { entityTypeId, opening, fieldId: field.data.id };
}

async function exercisePdfReferencesAndExports(
  auth: SessionAuth,
  project: Project,
  entityTypeId: string,
  itemId: string,
  fieldId: string,
) {
  const pdf = onePagePdf();
  const upload = await api<JsonEnvelope<{ id: string; version: number; uploadUrl: string }>>(
    '/api/v1/uploads',
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        kind: 'source_document',
        filename: 'integration-source.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf.byteLength,
      }),
    },
    auth,
  );
  const uploadHeaders = { 'content-type': 'application/pdf', 'if-none-match': '*' };
  const firstPut = await fetch(upload.data.uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: pdf,
  });
  expect(firstPut.status).toBe(200);
  const replayPut = await fetch(upload.data.uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: pdf,
  });
  expect([409, 412]).toContain(replayPut.status);

  const completed = await api<JsonEnvelope<{ id: string; status: string }>>(
    `/api/v1/projects/${project.id}/uploads/${upload.data.id}/complete`,
    201,
    { method: 'POST', body: JSON.stringify({ version: upload.data.version }) },
    auth,
  );
  expect(completed.data.status).toBe('READY');
  const document = await api<JsonEnvelope<{ id: string; pageCount: number }>>(
    `/api/v1/projects/${project.id}/source-documents`,
    201,
    {
      method: 'POST',
      body: JSON.stringify({ storageObjectId: upload.data.id, title: 'Integration source' }),
    },
    auth,
  );
  expect(document.data.pageCount).toBe(1);
  await api<JsonEnvelope<{ id: string }>>(
    `/api/v1/projects/${project.id}/items/${itemId}/source-references`,
    201,
    {
      method: 'POST',
      body: JSON.stringify({ sourceDocumentId: document.data.id, startPage: 1, endPage: 1 }),
    },
    auth,
  );
  const referenced = required(
    (await listItems(auth, project.id, entityTypeId)).find(({ id }) => id === itemId),
    'Referenced item was not returned',
  );
  expect(referenced.sourceReferences).toEqual([
    expect.objectContaining({ sourceDocumentId: document.data.id, startPage: 1, endPage: 1 }),
  ]);

  const csv = await request(
    `/api/v1/projects/${project.id}/exports/levels/${entityTypeId}.csv`,
    {},
    auth,
  );
  expect(csv.status).toBe(200);
  expect(csv.headers.get('content-type')).toContain('text/csv');
  const csvText = await csv.text();
  expect(csvText).toContain('Editorial note');
  expect(csvText).toContain('Hold on the final frame');

  const exported = await request(`/api/v1/projects/${project.id}/exports/project.json`, {}, auth);
  expect(exported.status).toBe(200);
  const projectExport = (await exported.json()) as {
    schemaVersion: number;
    project: { id: string; items: Item[]; fields: Array<{ id: string }> };
  };
  expect(projectExport.schemaVersion).toBe(1);
  expect(projectExport.project.id).toBe(project.id);
  expect(projectExport.project.fields.map(({ id }) => id)).toContain(fieldId);
  expect(
    projectExport.project.items.find(({ id }) => id === itemId)?.sourceReferences,
  ).toHaveLength(1);
}

async function createProjectInvitation(
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

async function acceptMemberInvitation(token: string): Promise<SessionAuth> {
  const described = await api<JsonEnvelope<{ kind: string; email: string }>>(
    `/api/v1/invitations/${encodeURIComponent(token)}`,
    200,
  );
  expect(described.data).toMatchObject({ kind: 'project', email: memberEmail });
  const accepted = await request('/api/v1/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({
      token,
      displayName: 'Integration Member',
      password: memberPassword,
    }),
  });
  const account = await responseJson<JsonEnvelope<{ email: string }>>(accepted, 201);
  expect(account.data.email).toBe(memberEmail);
  return authFrom(accepted);
}

async function exerciseInvitationsIsolationAndLifecycle(
  ownerAuth: SessionAuth,
  memberAuth: SessionAuth,
  sharedProject: Project,
) {
  expect((await request(`/api/v1/projects/${sharedProject.id}`, {}, memberAuth)).status).toBe(200);
  const isolatedCreated = await api<JsonEnvelope<{ id: string }>>(
    '/api/v1/projects',
    201,
    { method: 'POST', body: JSON.stringify({ name: 'Isolated disposable project' }) },
    ownerAuth,
  );
  const isolated = (
    await api<JsonEnvelope<Project>>(
      `/api/v1/projects/${isolatedCreated.data.id}`,
      200,
      {},
      ownerAuth,
    )
  ).data;
  expect((await request(`/api/v1/projects/${isolated.id}`, {}, memberAuth)).status).toBe(404);

  const revokedToken = await createProjectInvitation(
    ownerAuth,
    isolated,
    'revoked-integration-member@coda.local',
  );
  expect((await request(`/api/v1/invitations/${encodeURIComponent(revokedToken)}`)).status).toBe(
    200,
  );
  await api<JsonEnvelope<{ deletedAt: string }>>(
    `/api/v1/projects/${isolated.id}/trash`,
    200,
    { method: 'DELETE' },
    ownerAuth,
  );
  expect((await request(`/api/v1/invitations/${encodeURIComponent(revokedToken)}`)).status).toBe(
    404,
  );
  expect(
    (
      await request('/api/v1/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({
          token: revokedToken,
          displayName: 'Must Not Exist',
          password: memberPassword,
        }),
      })
    ).status,
  ).toBe(404);
  const trash = await api<JsonEnvelope<Array<{ id: string }>>>(
    '/api/v1/projects/trash',
    200,
    {},
    ownerAuth,
  );
  expect(trash.data.map(({ id }) => id)).toContain(isolated.id);

  await api<JsonEnvelope<{ id: string }>>(
    `/api/v1/projects/${isolated.id}/restore`,
    201,
    { method: 'POST' },
    ownerAuth,
  );
  expect((await request(`/api/v1/projects/${isolated.id}`, {}, ownerAuth)).status).toBe(200);
  expect((await request(`/api/v1/invitations/${encodeURIComponent(revokedToken)}`)).status).toBe(
    404,
  );
  await api<JsonEnvelope<{ id: string }>>(
    `/api/v1/projects/${isolated.id}/trash`,
    200,
    { method: 'DELETE' },
    ownerAuth,
  );
  await api<JsonEnvelope<{ purged: boolean }>>(
    `/api/v1/projects/${isolated.id}/purge`,
    200,
    { method: 'DELETE' },
    ownerAuth,
  );
  expect((await request(`/api/v1/projects/${isolated.id}`, {}, ownerAuth)).status).toBe(404);
}

async function exerciseCredentialBoundary(auth: SessionAuth, projectId: string) {
  const credential = await api<JsonEnvelope<{ token: string }>>(
    '/api/v1/account/credentials',
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        name: 'Integration API key',
        kind: 'api_key',
        permissions: ['read_project'],
      }),
    },
    auth,
  );
  const bearer = { authorization: `Bearer ${credential.data.token}` };
  const context = await api<JsonEnvelope<{ projectId: string }>>('/api/v1/token/context', 200, {
    headers: bearer,
  });
  expect(context.data.projectId).toBe(projectId);
  expect((await request('/api/v1/account', { headers: bearer })).status).toBe(403);
  expect(
    (
      await request('/api/v1/projects/90000000-0000-4000-8000-000000000009/items', {
        headers: bearer,
      })
    ).status,
  ).toBe(404);
}

function expectPrivateScreenplayResponse(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private,no-store');
  expect(
    response.headers
      .get('vary')
      ?.toLowerCase()
      .split(',')
      .map((value) => value.trim()),
  ).toContain('cookie');
}

async function exerciseScreenplays(auth: SessionAuth): Promise<void> {
  const createResponse = await request(
    '/api/v1/screenplays',
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'Integration Draft',
        sourceText: 'Title: Integration Draft\n',
      }),
    },
    auth,
  );
  expectPrivateScreenplayResponse(createResponse);
  const created = await responseJson<JsonEnvelope<{ id: string; version: number }>>(
    createResponse,
    201,
  );

  const listResponse = await request('/api/v1/screenplays?limit=1', {}, auth);
  expectPrivateScreenplayResponse(listResponse);
  const list = await responseJson<JsonEnvelope<Array<{ id: string }>>>(listResponse, 200);
  expect(list.data.length).toBeLessThanOrEqual(1);

  const getResponse = await request(`/api/v1/screenplays/${created.data.id}`, {}, auth);
  expectPrivateScreenplayResponse(getResponse);
  await responseJson(getResponse, 200);

  const updateResponse = await request(
    `/api/v1/screenplays/${created.data.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        version: created.data.version,
        sourceText: 'Title: Integration Draft\n\nINT. ROOM - DAY\n',
      }),
    },
    auth,
  );
  expectPrivateScreenplayResponse(updateResponse);
  await responseJson(updateResponse, 200);

  const exportResponse = await request(
    `/api/v1/screenplays/${created.data.id}/export.fountain`,
    {},
    auth,
  );
  expectPrivateScreenplayResponse(exportResponse);
  expect(exportResponse.status).toBe(200);

  const importResponse = await request(
    '/api/v1/screenplays/import',
    {
      method: 'POST',
      body: JSON.stringify({ filename: 'integration.fountain', sourceText: 'Title: Imported\n' }),
    },
    auth,
  );
  expectPrivateScreenplayResponse(importResponse);
  await responseJson(importResponse, 201);
}

describe('Coda API with disposable Postgres and object storage', () => {
  it('enforces the core persistence, storage, invitation, isolation, export, and lifecycle invariants', async () => {
    const ownerAuth = await setupOwner();
    const project = await createMovieProject(ownerAuth);
    const core = await exerciseItemsAndFields(ownerAuth, project);
    await exercisePdfReferencesAndExports(
      ownerAuth,
      project,
      core.entityTypeId,
      core.opening.id,
      core.fieldId,
    );
    const acceptedToken = await createProjectInvitation(ownerAuth, project, memberEmail);
    const memberAuth = await acceptMemberInvitation(acceptedToken);
    expect((await request(`/api/v1/invitations/${encodeURIComponent(acceptedToken)}`)).status).toBe(
      404,
    );
    await exerciseInvitationsIsolationAndLifecycle(ownerAuth, memberAuth, project);
    await exerciseCredentialBoundary(ownerAuth, project.id);
    await exerciseScreenplays(ownerAuth);
  }, 120_000);
});
