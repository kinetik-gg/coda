import { spawnSync } from 'node:child_process';
import { isImmutableImageReference, type RuntimeRole } from './runtime-audit';

const previousRelease =
  'ghcr.io/kinetik-gg/coda@sha256:3d214731054bb103b6ecbc65ccec8c43217caa211c0146c1e40bce6c66bc8cf0';
const postgresImage =
  'postgres:17.7-alpine@sha256:bb377b7239d2774ac8cc76f481596ce96c5a6b5e9d141f6d0a0ee371a6e7c0f2';
const objectStorageImage =
  'minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0';
const setupToken = 'deployment-smoke-setup-token-2026';
const ownerEmail = 'upgrade-smoke@coda.local';
const ownerPassword = 'UpgradeSmoke2026';

interface SmokeEnvironment {
  appUrl: string;
  environment: NodeJS.ProcessEnv;
  project: string;
}

interface RuntimeAuditTarget {
  allowedLoopbackPort?: number;
  files: string[];
  image: string;
  role: RuntimeRole;
  service: string;
}

function run(files: string[], args: string[], smoke: SmokeEnvironment): void {
  const command = [
    'compose',
    '--project-name',
    smoke.project,
    ...files.flatMap((file) => ['-f', file]),
    ...args,
  ];
  const result = spawnSync('docker', command, {
    env: smoke.environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker Compose failed with status ${result.status}`);
}

function composeContainer(smoke: SmokeEnvironment, files: string[], service: string): string {
  const command = [
    'compose',
    '--project-name',
    smoke.project,
    ...files.flatMap((file) => ['-f', file]),
    'ps',
    '--quiet',
    service,
  ];
  const result = spawnSync('docker', command, {
    encoding: 'utf8',
    env: smoke.environment,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Docker Compose could not resolve the ${service} container`);
  }
  const containers = result.stdout
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (containers.length !== 1) {
    throw new Error(`Docker Compose resolved an unexpected ${service} container count`);
  }
  return containers[0] as string;
}

async function waitForReadiness(smoke: SmokeEnvironment): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${smoke.appUrl}/api/v1/health/ready`);
      if (response.ok) return;
    } catch {
      // The container may not have published its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Coda did not become ready at ${smoke.appUrl}`);
}

function smokeEnvironment(project: string, appPort: number, objectPort: number): SmokeEnvironment {
  const databasePassword = process.env.POSTGRES_PASSWORD;
  if (!databasePassword)
    throw new Error('POSTGRES_PASSWORD is required for deployment smoke tests');
  const environment = {
    ...process.env,
    APP_ORIGIN: `http://localhost:${appPort}`,
    CODA_APP_PORT: String(appPort),
    CODA_BIND_ADDRESS: '127.0.0.1',
    CODA_S3_PORT: String(objectPort),
    CODA_S3_BIND_ADDRESS: '127.0.0.1',
    CODA_INTEGRATION_EMAIL: `${project}@coda.local`,
    CODA_INTEGRATION_PASSWORD: ownerPassword,
    CODA_INTEGRATION_SETUP_TOKEN: setupToken,
    CODA_INTEGRATION_URL: `http://127.0.0.1:${appPort}`,
    DATABASE_URL: `postgresql://coda:${encodeURIComponent(databasePassword)}@postgres:5432/coda?schema=public`,
    MINIO_CORS_ALLOW_ORIGIN: `http://localhost:${appPort}`,
    S3_ENDPOINT: 'http://minio:9000',
    S3_FORCE_PATH_STYLE: 'true',
    S3_PUBLIC_ENDPOINT: `http://localhost:${objectPort}`,
    SETUP_TOKEN: setupToken,
    TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
  };
  return { appUrl: `http://127.0.0.1:${appPort}`, environment, project };
}

function cleanup(smoke: SmokeEnvironment): void {
  try {
    run(['compose.app.yaml', 'compose.app.local.yaml'], ['down', '--remove-orphans'], smoke);
  } catch (error) {
    process.stderr.write(`App-only smoke cleanup failed: ${String(error)}\n`);
  }
  try {
    run(['compose.yaml', 'compose.local.yaml'], ['down', '--volumes', '--remove-orphans'], smoke);
  } catch (error) {
    process.stderr.write(`Dependency smoke cleanup failed: ${String(error)}\n`);
  }
}

function runIntegrationLoop(smoke: SmokeEnvironment): void {
  const packageManagerEntrypoint = process.env.npm_execpath;
  if (!packageManagerEntrypoint) throw new Error('npm_execpath is required for deployment smokes');
  const integration = spawnSync(process.execPath, [packageManagerEntrypoint, 'test:integration'], {
    env: smoke.environment,
    stdio: 'inherit',
  });
  if (integration.error) throw integration.error;
  if (integration.status !== 0) {
    throw new Error(`Deployment integration loop failed with status ${integration.status}`);
  }
}

async function waitForContainerHealth(
  container: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const inspection = spawnSync(
      'docker',
      [
        'inspect',
        '--type',
        'container',
        '--format',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
        container,
      ],
      { encoding: 'utf8', env: environment, windowsHide: true },
    );
    if (inspection.error || inspection.status !== 0) {
      throw new Error('Docker could not inspect a smoke container health state');
    }
    const status = inspection.stdout.trim();
    if (status === 'healthy') return;
    if (status !== 'starting' && status !== 'created') {
      throw new Error(`Smoke container entered unexpected health state ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Smoke container did not become healthy');
}

async function runRuntimeAudit(smoke: SmokeEnvironment, target: RuntimeAuditTarget): Promise<void> {
  const packageManagerEntrypoint = process.env.npm_execpath;
  if (!packageManagerEntrypoint) throw new Error('npm_execpath is required for runtime audits');
  const imageOption = isImmutableImageReference(target.image) ? '--image' : '--local-image';
  const container = composeContainer(smoke, target.files, target.service);
  await waitForContainerHealth(container, smoke.environment);
  const audit = spawnSync(
    process.execPath,
    [
      packageManagerEntrypoint,
      'deployment:audit-runtime',
      '--',
      '--container',
      container,
      imageOption,
      target.image,
      '--role',
      target.role,
      ...(target.allowedLoopbackPort === undefined
        ? []
        : ['--allow-loopback-port', String(target.allowedLoopbackPort)]),
    ],
    { env: smoke.environment, stdio: 'inherit' },
  );
  if (audit.error) throw audit.error;
  if (audit.status !== 0) throw new Error(`${target.role} runtime audit failed`);
}

async function auditSmokeRuntime(smoke: SmokeEnvironment, appFiles: string[]): Promise<void> {
  const dependencyFiles = ['compose.yaml', 'compose.local.yaml'];
  const codaImage = smoke.environment.CODA_IMAGE;
  if (!codaImage) throw new Error('CODA_IMAGE is required for runtime audits');
  await runRuntimeAudit(smoke, {
    allowedLoopbackPort: 3000,
    files: appFiles,
    image: codaImage,
    role: 'application',
    service: 'coda',
  });
  await runRuntimeAudit(smoke, {
    files: dependencyFiles,
    image: postgresImage,
    role: 'database',
    service: 'postgres',
  });
  await runRuntimeAudit(smoke, {
    allowedLoopbackPort: 9000,
    files: dependencyFiles,
    image: objectStorageImage,
    role: 'object-storage',
    service: 'minio',
  });
}

function verifyRestoredOwnershipRepair(smoke: SmokeEnvironment, files: string[]): void {
  const probe = '/data/.coda-ownership-restore-probe';
  run(
    files,
    ['exec', '-T', 'minio', '/bin/sh', '-ec', `touch /data/.coda-owner-v1 ${probe}`],
    smoke,
  );
  run(
    files,
    [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      '/bin/sh',
      'minio-permissions',
      '-ec',
      `chown 0:0 ${probe}`,
    ],
    smoke,
  );
  run(files, ['run', '--rm', '--no-deps', 'minio-permissions'], smoke);
  run(
    files,
    [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      '/bin/sh',
      'minio-permissions',
      '-ec',
      `test "$(stat -c %u:%g ${probe})" = "0:0"`,
    ],
    smoke,
  );
  run(
    files,
    ['run', '--rm', '--no-deps', '--env', 'MINIO_FORCE_OWNERSHIP_REPAIR=1', 'minio-permissions'],
    smoke,
  );
  run(
    files,
    [
      'exec',
      '-T',
      'minio',
      '/bin/sh',
      '-ec',
      `test "$(stat -c %u:%g /data/.coda-owner-v1)" = "1000:1000" &&
       test "$(stat -c %u:%g ${probe})" = "1000:1000" &&
       rm ${probe}`,
    ],
    smoke,
  );
}

async function freshInstall(mode: 'app-only' | 'full-stack'): Promise<void> {
  const appOnly = mode === 'app-only';
  const smoke = smokeEnvironment(
    `coda-${mode}-smoke`,
    appOnly ? 53_001 : 53_003,
    appOnly ? 59_001 : 59_003,
  );
  try {
    if (!appOnly) {
      const files = ['compose.yaml', 'compose.local.yaml'];
      run(files, ['up', '--detach', '--force-recreate'], smoke);
      await waitForReadiness(smoke);
      await auditSmokeRuntime(smoke, files);
      verifyRestoredOwnershipRepair(smoke, files);
      runIntegrationLoop(smoke);
      return;
    }
    run(
      ['compose.yaml', 'compose.local.yaml'],
      ['up', '--detach', 'postgres', 'minio', 'minio-init'],
      smoke,
    );
    run(
      ['compose.app.yaml', 'compose.app.local.yaml'],
      ['up', '--detach', '--force-recreate', 'coda'],
      smoke,
    );
    await waitForReadiness(smoke);
    await auditSmokeRuntime(smoke, ['compose.app.yaml', 'compose.app.local.yaml']);
    runIntegrationLoop(smoke);
  } finally {
    cleanup(smoke);
  }
}

async function jsonRequest(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  });
}

async function seedPreviousRelease(smoke: SmokeEnvironment): Promise<void> {
  const response = await jsonRequest(
    `${smoke.appUrl}/api/v1/setup/owner`,
    {
      displayName: 'Upgrade Smoke Owner',
      email: ownerEmail,
      password: ownerPassword,
    },
    { 'x-coda-setup-token': setupToken },
  );
  if (response.status !== 201) {
    throw new Error(`v0.0.1 setup failed with HTTP ${response.status}: ${await response.text()}`);
  }
}

async function verifyUpgradedRelease(smoke: SmokeEnvironment): Promise<void> {
  const status = await fetch(`${smoke.appUrl}/api/v1/setup/status`);
  const statusBody = (await status.json()) as { data?: { initialized?: boolean } };
  if (!status.ok || statusBody.data?.initialized !== true) {
    throw new Error('Upgraded release did not preserve initialized instance state');
  }
  const login = await jsonRequest(`${smoke.appUrl}/api/v1/auth/login`, {
    email: ownerEmail,
    password: ownerPassword,
  });
  if (login.status !== 201) {
    throw new Error(`Upgraded owner login failed with HTTP ${login.status}: ${await login.text()}`);
  }
}

async function upgradeFromPreviousRelease(): Promise<void> {
  const currentImage = process.env.CODA_IMAGE;
  if (!currentImage) throw new Error('CODA_IMAGE must name the current image under test');
  const smoke = smokeEnvironment('coda-upgrade-smoke', 53_002, 59_002);
  try {
    smoke.environment.CODA_IMAGE = previousRelease;
    run(['compose.yaml', 'compose.local.yaml'], ['up', '--detach', '--force-recreate'], smoke);
    await waitForReadiness(smoke);
    await seedPreviousRelease(smoke);
    smoke.environment.CODA_IMAGE = currentImage;
    run(
      ['compose.yaml', 'compose.local.yaml'],
      ['up', '--detach', '--no-deps', '--force-recreate', 'coda'],
      smoke,
    );
    await waitForReadiness(smoke);
    await auditSmokeRuntime(smoke, ['compose.yaml', 'compose.local.yaml']);
    await verifyUpgradedRelease(smoke);
  } finally {
    cleanup(smoke);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'app-only' || mode === 'full-stack') await freshInstall(mode);
  else if (mode === 'upgrade-v0.0.1') await upgradeFromPreviousRelease();
  else throw new Error('Usage: smoke-deployment.ts <app-only|full-stack|upgrade-v0.0.1>');
}

void main();
