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
  includeScreenplayArtifact?: boolean;
}

export interface ScreenplayImportArtifactProof {
  screenplayId: string;
  artifactId: string;
  originalBytes: Uint8Array;
  convertedFountain: string;
  report: Record<string, unknown>;
}

export interface SeededBackupFixture extends OwnerAuth {
  screenplayImportArtifact?: ScreenplayImportArtifactProof;
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

export async function loginBackupFixtureOwner(
  appUrl: string,
  email: string,
  password: string,
): Promise<OwnerAuth> {
  const response = await fetch(`${appUrl}/api/v1/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    headers: { 'content-type': 'application/json' },
  });
  if (response.status !== 201) {
    throw new Error(`Owner login returned HTTP ${response.status}: ${await response.text()}`);
  }
  return authFrom(response);
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

async function seedScreenplayImportArtifact(
  appUrl: string,
  auth: OwnerAuth,
): Promise<ScreenplayImportArtifactProof> {
  const originalBytes = new TextEncoder().encode('Synthetic DOCX original bytes\n');
  const convertedFountain = 'Title: Backup Artifact\n\nINT. ARCHIVE - DAY\n';
  const report = {
    schemaVersion: 1,
    sourceFormat: 'docx',
    adapter: { id: 'backup-fixture-docx', version: '1.0.0' },
    generatedAt: '2026-07-30T00:00:00.000Z',
    summary: { total: 1, preserved: 1, converted: 0, uncertain: 0, unsupported: 0 },
    warnings: [],
    elements: [
      {
        id: 'paragraph-1',
        status: 'preserved',
        source: {
          kind: 'paragraph',
          location: { unit: 'paragraph', start: 0, end: 1 },
        },
        target: { kind: 'scene_heading', location: { unit: 'line', start: 2, end: 3 } },
        summary: 'Scene heading preserved in Fountain.',
        warnings: [],
      },
    ],
  };
  const screenplay = await post<{ data: { id: string } }>(
    `${appUrl}/api/v1/screenplays`,
    201,
    { title: 'Backup Artifact' },
    authHeaders(auth),
  );
  const reservation = await post<{
    data: { id: string; uploadUrl: string; version: number };
  }>(
    `${appUrl}/api/v1/screenplays/${screenplay.data.id}/import-artifacts`,
    201,
    {
      originalFilename: 'backup-artifact.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: originalBytes.byteLength,
      sourceFormat: 'docx',
    },
    authHeaders(auth),
  );
  const put = await fetch(reservation.data.uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'if-none-match': '*',
    },
    body: originalBytes,
  });
  if (put.status !== 200) throw new Error(`Artifact upload returned HTTP ${put.status}`);
  await post(
    `${appUrl}/api/v1/screenplays/${screenplay.data.id}/import-artifacts/${reservation.data.id}/complete`,
    201,
    { version: reservation.data.version, convertedFountain, report },
    authHeaders(auth),
  );
  return {
    screenplayId: screenplay.data.id,
    artifactId: reservation.data.id,
    originalBytes,
    convertedFountain,
    report,
  };
}

/**
 * Reserves (but never completes) a screenplay import artifact, leaving
 * `converted_fountain` and `conversion_report` NULL in the database — the shape a
 * PENDING artifact has before conversion finishes. Used by the round-trip gate's
 * NULL-safety regression probe for `CONTENT_DIGEST_SQL` (see
 * `backup-roundtrip-core.ts`): a NULL in a digest column must not make
 * `string_agg` silently drop the row from the integrity digest.
 */
export async function reserveIncompleteScreenplayImportArtifact(
  appUrl: string,
  auth: OwnerAuth,
): Promise<void> {
  const screenplay = await post<{ data: { id: string } }>(
    `${appUrl}/api/v1/screenplays`,
    201,
    { title: 'Digest NULL-safety probe' },
    authHeaders(auth),
  );
  await post(
    `${appUrl}/api/v1/screenplays/${screenplay.data.id}/import-artifacts`,
    201,
    {
      originalFilename: 'digest-null-probe.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 4,
      sourceFormat: 'docx',
    },
    authHeaders(auth),
  );
}

/**
 * Provisions the owner, a movie-template project with one item carrying a text
 * field value, and one completed PDF upload. Returns the owner session so callers
 * can immediately download a backup. Deterministic content (no timestamps in the
 * seeded values) keeps the resulting content digest stable across regenerations.
 */
export async function seedBackupFixture(options: SeedOptions): Promise<SeededBackupFixture> {
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

  const screenplayImportArtifact = options.includeScreenplayArtifact
    ? await seedScreenplayImportArtifact(options.appUrl, auth)
    : undefined;
  return { ...auth, ...(screenplayImportArtifact ? { screenplayImportArtifact } : {}) };
}
