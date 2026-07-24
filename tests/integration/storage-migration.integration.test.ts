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

// Opt-in: only runs against the second MinIO backend from compose.storage-swap.yaml
// with this flag set, so the standard `pnpm test:integration` run is unaffected.
// See docs/operations.md → Storage settings wizard.
const enabled = process.env.CODA_STORAGE_SWAP === '1';

interface StorageConfigView {
  source: 'env' | 'config';
  bucket: string;
}
interface MigrationMismatch {
  objectKey: string;
  kind: 'missing' | 'size' | 'checksum' | 'error';
  detail: string;
}
interface MigrationStatus {
  phase: 'idle' | 'copying' | 'verifying' | 'verified' | 'failed' | 'cutover' | 'cancelled';
  copiedObjects: number;
  totalObjects: number;
  verifiedObjects: number;
  canCutover: boolean;
  error: string | null;
  report: {
    totalObjects: number;
    verifiedObjects: number;
    totalBytes: number;
    mismatches: MigrationMismatch[];
  } | null;
}
interface MigrationStartResult {
  status: 'started' | 'invalid';
  migration?: MigrationStatus;
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
const MIGRATION = '/api/v1/instance/storage-migration';

async function loginOwner(): Promise<SessionAuth> {
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  if (response.status !== 201) throw new Error(`Owner login failed with HTTP ${response.status}`);
  return authFrom(response);
}

async function getConfig(auth: SessionAuth): Promise<StorageConfigView> {
  return (await api<JsonEnvelope<StorageConfigView>>(CONFIG, 200, {}, auth)).data;
}

async function migrationStatus(auth: SessionAuth): Promise<MigrationStatus> {
  return (await api<JsonEnvelope<MigrationStatus>>(MIGRATION, 200, {}, auth)).data;
}

/** Uploads a distinct payload and returns the object id plus the bytes for later comparison. */
async function upload(
  auth: SessionAuth,
  project: Project,
  index: number,
): Promise<{ id: string; payload: Buffer }> {
  const payload = Buffer.from(`migrate-${index}-${'x'.repeat(index * 7)}`);
  const created = await api<JsonEnvelope<{ id: string; version: number; uploadUrl: string }>>(
    '/api/v1/uploads',
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        kind: 'file',
        filename: `migrate-${index}.bin`,
        mimeType: 'application/octet-stream',
        sizeBytes: payload.byteLength,
      }),
    },
    auth,
  );
  const put = await fetch(created.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
    body: Uint8Array.from(payload),
  });
  expect(put.status).toBe(200);
  await api<JsonEnvelope<{ status: string }>>(
    `/api/v1/projects/${project.id}/uploads/${created.data.id}/complete`,
    201,
    { method: 'POST', body: JSON.stringify({ version: created.data.version }) },
    auth,
  );
  return { id: created.data.id, payload };
}

async function readBytes(auth: SessionAuth, project: Project, id: string): Promise<Buffer> {
  const read = await api<JsonEnvelope<{ url: string }>>(
    `/api/v1/projects/${project.id}/storage-objects/${id}/content`,
    200,
    {},
    auth,
  );
  const downloaded = await fetch(read.data.url);
  expect(downloaded.status).toBe(200);
  return Buffer.from(await downloaded.arrayBuffer());
}

async function waitForPhase(
  auth: SessionAuth,
  phases: MigrationStatus['phase'][],
): Promise<MigrationStatus> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await migrationStatus(auth);
    if (phases.includes(status.phase)) return status;
    if (status.phase === 'failed')
      throw new Error(`Migration failed: ${status.error ?? 'unknown'}`);
    await sleep(1_000);
  }
  throw new Error(`Migration did not reach ${phases.join('/')} in time`);
}

describe.runIf(enabled)('Verified object migration', () => {
  let owner: SessionAuth;
  let project: Project;
  let initialBucket: string;
  const uploads: { id: string; payload: Buffer }[] = [];

  beforeAll(async () => {
    owner = await loginOwner();
    // Establish a known environment baseline and clear any prior migration.
    await api<JsonEnvelope<StorageConfigView>>(`${CONFIG}/revert`, 200, { method: 'POST' }, owner);
    await api<JsonEnvelope<MigrationStatus>>(`${MIGRATION}/cancel`, 200, { method: 'POST' }, owner);
    project = await provisionMovieProject(owner);
    for (let index = 1; index <= 3; index += 1) uploads.push(await upload(owner, project, index));
    initialBucket = (await getConfig(owner)).bucket;
  }, 60_000);

  it('rejects a target that fails its probe without starting', async () => {
    const result = (
      await api<JsonEnvelope<MigrationStartResult>>(
        `${MIGRATION}/start`,
        200,
        { method: 'POST', body: JSON.stringify({ ...second, secretAccessKey: 'wrong-secret' }) },
        owner,
      )
    ).data;
    expect(result.status).toBe('invalid');
    expect((await migrationStatus(owner)).phase).toBe('idle');
  });

  it('migrates and verifies every object with matching checksums, leaving the source active', async () => {
    const started = (
      await api<JsonEnvelope<MigrationStartResult>>(
        `${MIGRATION}/start`,
        200,
        { method: 'POST', body: JSON.stringify(second) },
        owner,
      )
    ).data;
    expect(started.status).toBe('started');

    const verified = await waitForPhase(owner, ['verified']);
    expect(verified.report).not.toBeNull();
    expect(verified.report?.mismatches).toEqual([]);
    expect(verified.report?.verifiedObjects).toBe(verified.report?.totalObjects);
    expect(verified.canCutover).toBe(true);

    // The source backend is untouched during copy + verify: still active.
    expect((await getConfig(owner)).bucket).toBe(initialBucket);
    expect((await getConfig(owner)).source).toBe('env');
  });

  it('cuts over only after verification and then serves reads from the target', async () => {
    const after = (
      await api<JsonEnvelope<MigrationStatus>>(
        `${MIGRATION}/cutover`,
        200,
        { method: 'POST' },
        owner,
      )
    ).data;
    expect(after.phase).toBe('cutover');

    const config = await getConfig(owner);
    expect(config.source).toBe('config');
    expect(config.bucket).toBe(second.bucket);

    // Reads now resolve from the migrated target and match the original bytes.
    for (const object of uploads) {
      expect(await readBytes(owner, project, object.id)).toEqual(object.payload);
    }
  });

  it('reverts to the environment backend and clears the migration', async () => {
    const reverted = (
      await api<JsonEnvelope<StorageConfigView>>(`${CONFIG}/revert`, 200, { method: 'POST' }, owner)
    ).data;
    expect(reverted.source).toBe('env');
    await api<JsonEnvelope<MigrationStatus>>(`${MIGRATION}/cancel`, 200, { method: 'POST' }, owner);
    expect((await migrationStatus(owner)).phase).toBe('idle');
  });
});
