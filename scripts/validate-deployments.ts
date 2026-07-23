import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface ComposePort {
  host_ip?: string;
  target?: number;
}

interface ComposeService {
  cap_drop?: string[];
  command?: string[];
  entrypoint?: string[];
  environment?: Record<string, string>;
  expose?: string[];
  image?: string;
  mem_limit?: string;
  memswap_limit?: string;
  pids_limit?: number;
  ports?: ComposePort[];
  read_only?: boolean;
  security_opt?: string[];
  tmpfs?: string[];
  volumes?: unknown;
}

interface ComposeConfig {
  services: Record<string, ComposeService>;
}

const envFile = '.env.example';
const hardenedCodaTmpfs = '/tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777';
const codaMemoryLimit = '2147483648';
const codaMemorySwapLimit = '2684354560';
const codaPidsLimit = 128;
const canonicalEnv = readFileSync(envFile, 'utf8');
const operationsDocumentation = readFileSync('docs/operations.md', 'utf8');
const validationEnvironment: NodeJS.ProcessEnv = { ...process.env };
for (const line of canonicalEnv.split(/\r?\n/u)) {
  const separator = line.indexOf('=');
  const key = separator > 0 ? line.slice(0, separator) : '';
  if (/^[A-Z][A-Z0-9_]*$/u.test(key)) delete validationEnvironment[key];
}
delete validationEnvironment.COMPOSE_FILE;
delete validationEnvironment.COMPOSE_PROFILES;

function fail(message: string): never {
  throw new Error(`Deployment validation failed: ${message}`);
}

function isComposeConfig(value: unknown): value is ComposeConfig {
  return typeof value === 'object' && value !== null && 'services' in value;
}

function composeConfig(
  files: string[],
  environment: NodeJS.ProcessEnv = validationEnvironment,
): ComposeConfig {
  const args = [
    'compose',
    '--env-file',
    envFile,
    ...files.flatMap((file) => ['-f', file]),
    'config',
    '--format',
    'json',
  ];
  const result = spawnSync('docker', args, { encoding: 'utf8', env: environment });
  if (result.error) fail(`could not execute Docker Compose: ${result.error.message}`);
  if (result.status !== 0) fail(`${files.join(' + ')} is invalid: ${result.stderr.trim()}`);
  const parsed: unknown = JSON.parse(result.stdout);
  if (!isComposeConfig(parsed)) fail(`${files.join(' + ')} returned an unexpected config`);
  return parsed;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertHardenedCoda(
  config: ComposeConfig,
  topology: string,
  requireImmutable = true,
): void {
  const coda = config.services.coda;
  assert(coda, `${topology} does not define coda`);
  if (requireImmutable) {
    assert(coda.image?.includes('@sha256:'), `${topology} does not require an immutable image`);
  }
  assert(coda.read_only === true, `${topology} coda filesystem is not read-only`);
  assert(coda.mem_limit === codaMemoryLimit, `${topology} coda memory limit is not 2 GiB`);
  assert(
    coda.memswap_limit === codaMemorySwapLimit,
    `${topology} coda memory-plus-swap limit is not 2.5 GiB`,
  );
  assert(coda.pids_limit === codaPidsLimit, `${topology} coda PID limit is not 128`);
  assert(
    coda.tmpfs?.includes(hardenedCodaTmpfs),
    `${topology} does not declare a bounded, hardened /tmp`,
  );
  assert(
    coda.security_opt?.includes('no-new-privileges:true'),
    `${topology} does not disable privilege escalation`,
  );
  assert(coda.cap_drop?.includes('ALL'), `${topology} does not drop Linux capabilities`);
  assert(coda.expose?.includes('3000'), `${topology} does not expose Coda internally`);
}

function assertNoPublishedPorts(config: ComposeConfig, topology: string): void {
  for (const [serviceName, service] of Object.entries(config.services)) {
    assert(!service.ports?.length, `${topology} unexpectedly publishes ${serviceName} ports`);
  }
}

function publishedPort(
  config: ComposeConfig,
  serviceName: string,
  target: number,
): ComposePort | undefined {
  return config.services[serviceName]?.ports?.find((port) => port.target === target);
}

const full = composeConfig(['compose.yaml']);
const app = composeConfig(['compose.app.yaml']);
const fullLocal = composeConfig(['compose.yaml', 'compose.local.yaml']);
const appLocal = composeConfig(['compose.app.yaml', 'compose.app.local.yaml']);
const development = composeConfig(['compose.yaml', 'compose.dev.yaml']);
const test = composeConfig(['compose.yaml', 'compose.test.yaml']);
const managedDatabaseUrl =
  'postgresql://user:password@db.example.test:5432/coda?schema=public&sslmode=require&sslaccept=strict';
const managedApp = composeConfig(['compose.app.yaml'], {
  ...validationEnvironment,
  DATABASE_URL: managedDatabaseUrl,
  S3_FORCE_PATH_STYLE: 'false',
});
const appRuntimeEnv = readFileSync('deploy/coda.app.env.example', 'utf8');

assertHardenedCoda(full, 'full-stack topology');
assertHardenedCoda(app, 'app-only topology');
assertNoPublishedPorts(full, 'full-stack topology');
assertNoPublishedPorts(app, 'app-only topology');
assert(
  Object.keys(app.services).join(',') === 'coda',
  'app-only topology contains bundled services',
);
assert(
  managedApp.services.coda?.environment?.S3_FORCE_PATH_STYLE === 'false',
  'app-only topology cannot enable virtual-hosted S3 addressing',
);
assert(
  managedApp.services.coda?.environment?.DATABASE_URL === managedDatabaseUrl,
  'app-only topology does not preserve managed PostgreSQL TLS parameters',
);
assert(
  full.services.coda?.image === app.services.coda?.image,
  'topologies use different Coda images',
);
assert(
  full.services.minio?.expose?.includes('9000'),
  'full stack does not expose MinIO internally',
);
assert(
  full.services.minio?.command?.join(' ').includes('--console-address 127.0.0.1:9001'),
  'MinIO administration is not bound to loopback',
);
assert(
  full.services.postgres?.expose?.includes('5432'),
  'full stack does not expose Postgres internally',
);
assert(!full.services.minio?.expose?.includes('9001'), 'MinIO administration is exposed');
assert(!full.services['minio-init']?.volumes, 'MinIO bootstrap uses a runtime mount');
assert(
  full.services['minio-init']?.entrypoint?.join('\n').includes('mc mb --ignore-existing'),
  'MinIO bootstrap is not rerun-safe',
);
for (const key of [
  'APP_ORIGIN',
  'TRUSTED_PROXY_CIDRS',
  'DATABASE_URL',
  'SETUP_TOKEN',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_FORCE_PATH_STYLE',
]) {
  assert(new RegExp(`^${key}=`, 'mu').test(appRuntimeEnv), `app runtime template omits ${key}`);
}
for (const forbidden of [
  'CODA_IMAGE',
  'POSTGRES_PASSWORD',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
]) {
  assert(
    !new RegExp(`^${forbidden}=`, 'mu').test(appRuntimeEnv),
    `app runtime template leaks ${forbidden}`,
  );
}
assert(
  full.services.coda?.environment?.S3_FORCE_PATH_STYLE === 'true' &&
    app.services.coda?.environment?.S3_FORCE_PATH_STYLE === 'true',
  'S3 addressing mode is not propagated consistently',
);
assert(
  operationsDocumentation.includes(`--tmpfs ${hardenedCodaTmpfs}`),
  'app-only docker run documentation diverges from the canonical /tmp contract',
);
for (const option of ['--memory 2g', '--memory-swap 2560m', '--pids-limit 128']) {
  assert(
    operationsDocumentation.includes(option),
    `app-only docker run documentation omits ${option}`,
  );
}

const releaseLocalTopologies: Array<[ComposeConfig, string]> = [
  [fullLocal, 'full-stack localhost override'],
  [appLocal, 'app-only localhost override'],
];
for (const [config, topology] of releaseLocalTopologies) {
  assertHardenedCoda(config, topology);
  const appPort = publishedPort(config, 'coda', 3000);
  assert(appPort?.host_ip === '127.0.0.1', `${topology} does not bind Coda to localhost`);
}

const localTestTopologies: Array<[ComposeConfig, string]> = [
  [development, 'development override'],
  [test, 'test override'],
];
for (const [config, topology] of localTestTopologies) {
  assertHardenedCoda(config, topology, false);
  const appPort = publishedPort(config, 'coda', 3000);
  assert(appPort?.host_ip === '127.0.0.1', `${topology} does not bind Coda to localhost`);
}

const localObjectTopologies: Array<[ComposeConfig, string]> = [
  [fullLocal, 'full-stack localhost override'],
  [development, 'development override'],
  [test, 'test override'],
];
for (const [config, topology] of localObjectTopologies) {
  const objectPort = publishedPort(config, 'minio', 9000);
  assert(objectPort?.host_ip === '127.0.0.1', `${topology} does not bind MinIO to localhost`);
}

process.stdout.write(
  'Validated canonical full-stack, app-only, localhost, development, and test topologies.\n',
);
