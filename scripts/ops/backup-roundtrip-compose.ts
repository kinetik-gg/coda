import { spawnSync } from 'node:child_process';
import { CONTENT_DIGEST_SQL, normalizeDigest } from './backup-roundtrip-core';

/**
 * Docker Compose stack lifecycle shared by the in-app backup round-trip gate and the
 * committed-fixture generator. Both boot the bundled full-stack topology
 * (compose.yaml + compose.local.yaml), wait for readiness, and read the business
 * content digest, so that lifecycle lives here once. All credentials are synthetic
 * test material for this PUBLIC repository.
 */

export const ROUNDTRIP_SETUP_TOKEN = 'app-backup-roundtrip-setup-token-2026';
export const ROUNDTRIP_OWNER_EMAIL = 'roundtrip-owner@coda.local';
export const ROUNDTRIP_OWNER_PASSWORD = 'RoundtripFixture2026!';

export interface Stack {
  appUrl: string;
  environment: NodeJS.ProcessEnv;
  files: string[];
  project: string;
}

function requireImage(): string {
  const image = process.env.CODA_IMAGE;
  if (!image) throw new Error('CODA_IMAGE must name the build under test');
  return image;
}

export function stack(
  project: string,
  appPort: number,
  objectPort: number,
  configEncryptionKey: string,
): Stack {
  const databasePassword = 'roundtrip-postgres-password';
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CODA_IMAGE: requireImage(),
    APP_ORIGIN: `http://localhost:${appPort}`,
    CODA_APP_PORT: String(appPort),
    CODA_BIND_ADDRESS: '127.0.0.1',
    CODA_S3_PORT: String(objectPort),
    CODA_S3_BIND_ADDRESS: '127.0.0.1',
    CONFIG_ENCRYPTION_KEY: configEncryptionKey,
    DATABASE_URL: `postgresql://coda:${databasePassword}@postgres:5432/coda?schema=public`,
    POSTGRES_PASSWORD: databasePassword,
    MINIO_ROOT_USER: 'roundtriproot',
    MINIO_ROOT_PASSWORD: 'roundtrip-minio-password',
    MINIO_CORS_ALLOW_ORIGIN: `http://localhost:${appPort}`,
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_ENDPOINT: `http://localhost:${objectPort}`,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'coda-roundtrip',
    S3_ACCESS_KEY: 'roundtrip-app',
    S3_SECRET_KEY: 'roundtrip-app-secret',
    S3_FORCE_PATH_STYLE: 'true',
    SETUP_TOKEN: ROUNDTRIP_SETUP_TOKEN,
    TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
  };
  return {
    appUrl: `http://127.0.0.1:${appPort}`,
    environment,
    files: ['compose.yaml', 'compose.local.yaml'],
    project,
  };
}

export function compose(target: Stack, args: string[], capture = false): string {
  const command = [
    'compose',
    '--project-name',
    target.project,
    ...target.files.flatMap((file) => ['-f', file]),
    ...args,
  ];
  const result = spawnSync('docker', command, {
    encoding: 'utf8',
    env: target.environment,
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed with status ${result.status}`);
  }
  return capture ? result.stdout : '';
}

/** Boots the full stack fresh (source instance shape) and waits for readiness. */
export async function bootFreshStack(target: Stack): Promise<void> {
  compose(target, ['up', '--detach', '--force-recreate']);
  await waitForReadiness(target);
}

/**
 * Boots only the dependencies then the app with a clean database and bucket, the
 * shape an operator restores into during first-run setup.
 */
export async function bootUninitializedStack(target: Stack): Promise<void> {
  compose(target, ['up', '--detach', 'postgres', 'minio', 'minio-init']);
  compose(target, ['up', '--detach', '--no-deps', '--force-recreate', 'coda']);
  await waitForReadiness(target);
}

export function tearDown(target: Stack): void {
  try {
    compose(target, ['down', '--volumes', '--remove-orphans'], true);
  } catch (error) {
    process.stderr.write(`Round-trip cleanup failed for ${target.project}: ${String(error)}\n`);
  }
}

function dumpLogsOnFailure(target: Stack): void {
  spawnSync(
    'sh',
    [
      '-c',
      `docker ps -a --filter label=com.docker.compose.project=${target.project} ` +
        `--format '{{.Names}}' | while read -r name; do ` +
        `echo "===== $name ====="; docker logs --tail 200 "$name" 2>&1; done`,
    ],
    { stdio: 'inherit' },
  );
}

export async function waitForReadiness(target: Stack): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${target.appUrl}/api/v1/health/ready`);
      if (response.ok) return;
    } catch {
      // Socket not published yet.
    }
    await new Promise((done) => setTimeout(done, 2_000));
  }
  dumpLogsOnFailure(target);
  throw new Error(`Coda did not become ready at ${target.appUrl}`);
}

/** Reads the deterministic business-content digest from the stack's database. */
export function contentDigest(target: Stack): string {
  const output = compose(
    target,
    [
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${target.environment.POSTGRES_PASSWORD ?? ''}`,
      'postgres',
      'psql',
      '-U',
      'coda',
      '-d',
      'coda',
      '-tAc',
      CONTENT_DIGEST_SQL,
    ],
    true,
  );
  return normalizeDigest(output);
}
