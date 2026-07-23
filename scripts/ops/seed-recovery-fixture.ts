const baseUrl = process.env.CODA_RECOVERY_URL ?? 'http://127.0.0.1:53016';
const setupToken = process.env.CODA_RECOVERY_SETUP_TOKEN;
const ownerEmail = 'recovery-owner@coda.local';
const ownerPassword = 'RecoveryFixture2026!';

interface Authentication {
  cookies: string;
  csrf: string;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown recovery fixture error';
}

function responseCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [];
}

function authentication(response: Response): Authentication {
  const cookies = responseCookies(response)
    .map((value) => value.split(';', 1)[0])
    .join('; ');
  const csrf = /(?:^|; )coda_csrf=([^;]+)/u.exec(cookies)?.[1];
  if (!csrf) throw new Error('Owner setup did not return the CSRF cookie');
  return { cookies, csrf: decodeURIComponent(csrf) };
}

async function jsonRequest<T>(
  path: string,
  expectedStatus: number,
  body?: unknown,
  auth?: Authentication,
): Promise<{ body: T; response: Response }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(auth ? { cookie: auth.cookies, 'x-coda-csrf': auth.csrf } : {}),
      ...(path === '/api/v1/setup/owner'
        ? { 'x-coda-setup-token': required(setupToken, 'CODA_RECOVERY_SETUP_TOKEN') }
        : {}),
    },
  });
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${text}`);
  }
  return { body: JSON.parse(text) as T, response };
}

function onePagePdf(): Uint8Array {
  const body =
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return new TextEncoder().encode(body);
}

async function main(): Promise<void> {
  const setup = await jsonRequest<unknown>('/api/v1/setup/owner', 201, {
    displayName: 'Recovery Owner',
    email: ownerEmail,
    password: ownerPassword,
  });
  const auth = authentication(setup.response);
  const project = await jsonRequest<{ data: { id: string } }>(
    '/api/v1/projects/from-template',
    201,
    {
      name: 'Recovery Fixture',
      description: 'Disposable recovery validation',
      templateId: 'movie',
    },
    auth,
  );
  const pdf = onePagePdf();
  const upload = await jsonRequest<{ data: { id: string; uploadUrl: string; version: number } }>(
    '/api/v1/uploads',
    201,
    {
      projectId: project.body.data.id,
      kind: 'source_document',
      filename: 'recovery-fixture.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.byteLength,
    },
    auth,
  );
  const objectResponse = await fetch(upload.body.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'if-none-match': '*' },
    body: Uint8Array.from(pdf).buffer,
  });
  if (objectResponse.status !== 200)
    throw new Error(`Object upload returned ${objectResponse.status}`);
  await jsonRequest(
    `/api/v1/projects/${project.body.data.id}/uploads/${upload.body.data.id}/complete`,
    201,
    { version: upload.body.data.version },
    auth,
  );
  process.stdout.write(`Seeded recovery fixture project ${project.body.data.id}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
