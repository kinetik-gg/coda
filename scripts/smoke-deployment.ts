import { spawnSync } from 'node:child_process';

const previousRelease =
  'ghcr.io/kinetik-gg/coda@sha256:3d214731054bb103b6ecbc65ccec8c43217caa211c0146c1e40bce6c66bc8cf0';
const setupToken = 'deployment-smoke-setup-token-2026';
const ownerEmail = 'upgrade-smoke@coda.local';
const ownerPassword = 'UpgradeSmoke2026';

interface SmokeEnvironment {
  appUrl: string;
  environment: NodeJS.ProcessEnv;
  project: string;
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

async function appOnlyFreshInstall(): Promise<void> {
  const smoke = smokeEnvironment('coda-app-only-smoke', 53_001, 59_001);
  try {
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
    const packageManagerEntrypoint = process.env.npm_execpath;
    if (!packageManagerEntrypoint)
      throw new Error('npm_execpath is required for deployment smokes');
    const integration = spawnSync(
      process.execPath,
      [packageManagerEntrypoint, 'test:integration'],
      {
        env: smoke.environment,
        stdio: 'inherit',
      },
    );
    if (integration.error) throw integration.error;
    if (integration.status !== 0) {
      throw new Error(`App-only integration loop failed with status ${integration.status}`);
    }
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
    await verifyUpgradedRelease(smoke);
  } finally {
    cleanup(smoke);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'app-only') await appOnlyFreshInstall();
  else if (mode === 'upgrade-v0.0.1') await upgradeFromPreviousRelease();
  else throw new Error('Usage: smoke-deployment.ts <app-only|upgrade-v0.0.1>');
}

void main();
