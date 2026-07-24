/**
 * Shared synthetic-data seeder for the in-app backup gate. Both the round-trip gate
 * (`validate-app-backup-roundtrip.ts`) and the committed-fixture generator
 * (`generate-backup-fixture.ts`) plant the same demo project, item, field value, and
 * uploaded object so the resulting archive exercises both the database dump and the
 * object-storage inventory. All content is obvious, non-secret demo material.
 */

export interface SeedOptions {
  appUrl: string;
  setupToken: string;
  ownerEmail: string;
  ownerPassword: string;
}

export interface OwnerAuth {
  cookies: string;
  csrf: string;
}

function responseCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [];
}

function authFrom(response: Response): OwnerAuth {
  const cookies = responseCookies(response)
    .map((value) => value.split(';', 1)[0])
    .join('; ');
  const csrf = /(?:^|; )coda_csrf=([^;]+)/u.exec(cookies)?.[1];
  if (!csrf) throw new Error('Owner setup did not return the CSRF cookie');
  return { cookies, csrf: decodeURIComponent(csrf) };
}

async function send<T>(
  method: 'POST' | 'PUT',
  url: string,
  expectedStatus: number,
  body: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned ${response.status}, expected ${expectedStatus}: ${text}`);
  }
  return JSON.parse(text) as T;
}

function post<T>(
  url: string,
  expectedStatus: number,
  body: unknown,
  headers: Record<string, string>,
): Promise<T> {
  return send<T>('POST', url, expectedStatus, body, headers);
}

function authHeaders(auth: OwnerAuth): Record<string, string> {
  return { cookie: auth.cookies, 'x-coda-csrf': auth.csrf };
}

/** A minimal, valid single-page PDF used as the uploaded source document. */
function onePagePdf(): Uint8Array {
  const body =
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return new TextEncoder().encode(body);
}

/**
 * Provisions the owner, a movie-template project with one item carrying a text
 * field value, and one completed PDF upload. Returns the owner session so callers
 * can immediately download a backup. Deterministic content (no timestamps in the
 * seeded values) keeps the resulting content digest stable across regenerations.
 */
export async function seedBackupFixture(options: SeedOptions): Promise<OwnerAuth> {
  const setup = await fetch(`${options.appUrl}/api/v1/setup/owner`, {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Round-trip Owner',
      email: options.ownerEmail,
      password: options.ownerPassword,
    }),
    headers: { 'content-type': 'application/json', 'x-coda-setup-token': options.setupToken },
  });
  if (setup.status !== 201) {
    throw new Error(`Owner setup returned HTTP ${setup.status}: ${await setup.text()}`);
  }
  const auth = authFrom(setup);

  const project = await post<{ data: { id: string } }>(
    `${options.appUrl}/api/v1/projects/from-template`,
    201,
    {
      name: 'Backup Round-trip Fixture',
      description: 'Synthetic demo data for the backup portability gate',
      templateId: 'movie',
    },
    authHeaders(auth),
  );
  const projectId = project.data.id;

  const detailResponse = await fetch(`${options.appUrl}/api/v1/projects/${projectId}`, {
    headers: authHeaders(auth),
  });
  const detail = (await detailResponse.json()) as {
    data: { entityTypes: Array<{ id: string }> };
  };
  const entityTypeId = detail.data.entityTypes[0]?.id;
  if (!entityTypeId) throw new Error('Movie template returned no entity types');

  const item = await post<{ data: { id: string; version: number } }>(
    `${options.appUrl}/api/v1/projects/${projectId}/items`,
    201,
    { entityTypeId, title: 'Opening sequence' },
    authHeaders(auth),
  );

  const field = await post<{ data: { id: string } }>(
    `${options.appUrl}/api/v1/projects/${projectId}/fields`,
    201,
    {
      entityTypeId,
      name: 'Editorial note',
      key: 'editorial_note',
      type: 'text',
      required: false,
    },
    authHeaders(auth),
  );

  await send(
    'PUT',
    `${options.appUrl}/api/v1/projects/${projectId}/items/${item.data.id}/fields/${field.data.id}`,
    200,
    {
      value: { type: 'text', value: 'Hold on the final frame' },
      itemVersion: item.data.version,
    },
    authHeaders(auth),
  );

  const pdf = onePagePdf();
  const upload = await post<{ data: { id: string; uploadUrl: string; version: number } }>(
    `${options.appUrl}/api/v1/uploads`,
    201,
    {
      projectId,
      kind: 'source_document',
      filename: 'backup-fixture.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.byteLength,
    },
    authHeaders(auth),
  );
  const put = await fetch(upload.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'if-none-match': '*' },
    body: new Uint8Array(pdf),
  });
  if (put.status !== 200) throw new Error(`Object upload returned HTTP ${put.status}`);
  await post(
    `${options.appUrl}/api/v1/projects/${projectId}/uploads/${upload.data.id}/complete`,
    201,
    { version: upload.data.version },
    authHeaders(auth),
  );

  return auth;
}
