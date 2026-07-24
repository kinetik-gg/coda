import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  api,
  authFrom,
  ownerEmail,
  ownerPassword,
  provisionMovieProject,
  request,
  type JsonEnvelope,
  type Project,
  type SessionAuth,
} from './support/api-client';

// Opt-in: only runs when the second MinIO backend from compose.storage-swap.yaml
// is up and this flag is set, so the standard `pnpm test:integration` run is
// unaffected. See docs/operations.md → Storage settings wizard.
const enabled = process.env.CODA_STORAGE_SWAP === '1';

interface StorageConfigView {
  source: 'env' | 'config';
  bucket: string;
  provider: string | null;
}
interface StorageProbeResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}
interface StorageApplyResult {
  status: 'applied' | 'invalid' | 'needs_choice';
  probe: StorageProbeResult;
  config?: StorageConfigView;
  existingObjectCount?: number;
}

const second = {
  provider: 'minio' as const,
  endpoint: process.env.S3_SECOND_ENDPOINT ?? 'http://minio2:9000',
  publicEndpoint: process.env.S3_SECOND_PUBLIC_ENDPOINT ?? 'http://localhost:59100',
  region: process.env.S3_SECOND_REGION ?? 'us-east-1',
  bucket: process.env.S3_SECOND_BUCKET ?? 'coda-second',
  accessKeyId: process.env.S3_SECOND_ACCESS_KEY ?? 'integration-app-2',
  secretAccessKey: process.env.S3_SECOND_SECRET_KEY ?? 'integration-app-2-secret',
  forcePathStyle: true,
};

const CONFIG = '/api/v1/instance/storage-config';

// Log in directly (the shared cache is seeded by the setup scenario, which does
// not run when this file executes on an already-initialised stack). Login returns
// 201; the resulting cookie session survives the app container recreate because
// Postgres is not recreated, so one login is reused across every scenario here.
async function loginOwner(): Promise<SessionAuth> {
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  if (response.status !== 201) {
    throw new Error(`Owner login failed with HTTP ${response.status}`);
  }
  return authFrom(response);
}

async function getConfig(auth: SessionAuth): Promise<StorageConfigView> {
  return (await api<JsonEnvelope<StorageConfigView>>(CONFIG, 200, {}, auth)).data;
}

async function applyConfig(
  auth: SessionAuth,
  body: Record<string, unknown>,
): Promise<StorageApplyResult> {
  return (
    await api<JsonEnvelope<StorageApplyResult>>(
      `${CONFIG}/apply`,
      200,
      { method: 'POST', body: JSON.stringify(body) },
      auth,
    )
  ).data;
}

async function uploadRoundTrip(auth: SessionAuth, project: Project): Promise<void> {
  const payload = Buffer.from(`hot-swap-${Date.now()}`);
  const upload = await api<JsonEnvelope<{ id: string; version: number; uploadUrl: string }>>(
    '/api/v1/uploads',
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        kind: 'file',
        filename: 'hot-swap.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: payload.byteLength,
      }),
    },
    auth,
  );
  const put = await fetch(upload.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
    body: Uint8Array.from(payload),
  });
  expect(put.status).toBe(200);
  await api<JsonEnvelope<{ status: string }>>(
    `/api/v1/projects/${project.id}/uploads/${upload.data.id}/complete`,
    201,
    { method: 'POST', body: JSON.stringify({ version: upload.data.version }) },
    auth,
  );
  const read = await api<JsonEnvelope<{ url: string }>>(
    `/api/v1/projects/${project.id}/storage-objects/${upload.data.id}/content`,
    200,
    {},
    auth,
  );
  const downloaded = await fetch(read.data.url);
  expect(downloaded.status).toBe(200);
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(payload);
}

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await request('/api/v1/health/ready')).status === 200) return;
    } catch {
      // container is still coming back up
    }
    await sleep(2_000);
  }
  throw new Error('Coda did not become ready after recreate');
}

describe.runIf(enabled)('Storage backend hot-swap', () => {
  let owner: SessionAuth;
  let project: Project;
  let initialBucket: string;

  beforeAll(async () => {
    owner = await loginOwner();
    // Establish a known environment baseline regardless of prior state.
    await api<JsonEnvelope<StorageConfigView>>(`${CONFIG}/revert`, 200, { method: 'POST' }, owner);
    project = await provisionMovieProject(owner);
    initialBucket = (await getConfig(owner)).bucket;
  });

  it('never partially applies invalid credentials', async () => {
    const result = await applyConfig(owner, {
      ...second,
      secretAccessKey: 'wrong-secret',
      existingObjects: 'start_empty',
    });
    expect(result.status).toBe('invalid');
    expect(result.probe.ok).toBe(false);
    const after = await getConfig(owner);
    expect(after.bucket).toBe(initialBucket);
  });

  it('switches to the second MinIO and serves uploads without a restart', async () => {
    const result = await applyConfig(owner, { ...second, existingObjects: 'start_empty' });
    expect(result.status).toBe('applied');
    expect(result.config?.source).toBe('config');
    expect(result.config?.bucket).toBe(second.bucket);

    const active = await getConfig(owner);
    expect(active.bucket).toBe(second.bucket);
    await uploadRoundTrip(owner, project);
  });

  it.runIf(process.env.CODA_STORAGE_SWAP_RECREATE === '1')(
    'survives a container recreate by reloading the encrypted configuration',
    async () => {
      const projectName = process.env.CODA_STORAGE_SWAP_PROJECT ?? 'coda-verify';
      const envFile = process.env.CODA_STORAGE_SWAP_ENV_FILE;
      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          projectName,
          ...(envFile ? ['--env-file', envFile] : []),
          '-f',
          'compose.yaml',
          '-f',
          'compose.test.yaml',
          '-f',
          'compose.storage-swap.yaml',
          'up',
          '--detach',
          '--force-recreate',
          '--no-deps',
          'coda',
        ],
        { stdio: 'inherit' },
      );
      await waitForReady();
      // Reuse the existing session: it survives the recreate because Postgres is
      // not recreated, and it proves the swapped backend was reloaded at boot.
      const restored = await getConfig(owner);
      expect(restored.source).toBe('config');
      expect(restored.bucket).toBe(second.bucket);
      await uploadRoundTrip(owner, project);
    },
  );

  it('reverts to the environment backend', async () => {
    const reverted = (
      await api<JsonEnvelope<StorageConfigView>>(`${CONFIG}/revert`, 200, { method: 'POST' }, owner)
    ).data;
    expect(reverted.source).toBe('env');
    expect(reverted.bucket).toBe(initialBucket);
  });
});
