const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const repositoryRoot = resolve(__dirname, '..', '..');
const immutableImage = `ghcr.io/kinetik-gg/coda@sha256:${'1'.repeat(64)}`;

function environmentFrom(path) {
  const environment = { ...process.env };
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator <= 0 || line.startsWith('#')) continue;
    const name = line.slice(0, separator);
    environment[name] = line.slice(separator + 1);
  }
  environment.CODA_IMAGE = immutableImage;
  delete environment.COMPOSE_FILE;
  delete environment.COMPOSE_PROFILES;
  return environment;
}

function render(path, environment) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      'coda-coolify-validation',
      '-f',
      path,
      'config',
      '--format',
      'json',
    ],
    { cwd: repositoryRoot, encoding: 'utf8', env: environment },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function renderCoolify(path, environment) {
  const source = readFileSync(path, 'utf8');
  const extension = /^    exclude_from_hc: true\r?$/gmu;
  const matches = source.match(extension) ?? [];
  if (path.endsWith('compose.full.yaml')) assert.equal(matches.length, 1);
  else assert.equal(matches.length, 0);
  const directory = mkdtempSync(join(tmpdir(), 'coda-coolify-compose-'));
  const sanitized = join(directory, 'compose.yaml');
  try {
    writeFileSync(sanitized, source.replace(extension, ''), 'utf8');
    return render(sanitized, environment);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function comparable(config) {
  return { services: config.services, volumes: config.volumes ?? {} };
}

function assertHardened(config, topology) {
  const coda = config.services.coda;
  assert.ok(coda, `${topology} omits Coda`);
  assert.equal(coda.image, immutableImage);
  assert.equal(coda.read_only, true);
  assert.ok(coda.tmpfs.includes('/tmp'));
  assert.ok(coda.cap_drop.includes('ALL'));
  assert.ok(coda.security_opt.includes('no-new-privileges:true'));
  assert.ok(coda.expose.includes('3000'));
  assert.ok(coda.healthcheck.test.join(' ').includes('/api/v1/health/ready'));
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal(service.ports, undefined, `${topology} publishes ${name} directly`);
  }
}

function assertEnvironmentTemplate(path) {
  const content = readFileSync(path, 'utf8');
  assert.match(
    content,
    /^CODA_IMAGE=ghcr\.io\/kinetik-gg\/coda@sha256:replace-with-release-manifest-digest$/mu,
  );
  assert.doesNotMatch(content, /:latest(?:\s|$)/u);
  const application = content.match(/^APP_ORIGIN=(.+)$/mu)?.[1];
  const objects = content.match(/^S3_PUBLIC_ENDPOINT=(.+)$/mu)?.[1];
  assert.ok(application?.startsWith('https://'));
  assert.ok(objects?.startsWith('https://'));
  assert.notEqual(application, objects);
  for (const key of [
    'TRUSTED_PROXY_CIDRS',
    'DATABASE_URL',
    'SETUP_TOKEN',
    'S3_BUCKET',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_FORCE_PATH_STYLE',
  ]) {
    assert.match(content, new RegExp(`^${key}=`, 'mu'), `${path} omits ${key}`);
  }
}

const fullPath = resolve(__dirname, 'compose.full.yaml');
const appPath = resolve(__dirname, 'compose.app.yaml');
const fullEnvironmentPath = resolve(__dirname, 'full.env.example');
const appEnvironmentPath = resolve(__dirname, 'app.env.example');
const fullEnvironment = environmentFrom(fullEnvironmentPath);
const appEnvironment = environmentFrom(appEnvironmentPath);
const coolifyFull = renderCoolify(fullPath, fullEnvironment);
const canonicalFull = render(resolve(repositoryRoot, 'compose.yaml'), fullEnvironment);
const coolifyApp = renderCoolify(appPath, appEnvironment);
const canonicalApp = render(resolve(repositoryRoot, 'compose.app.yaml'), appEnvironment);
const fullSource = readFileSync(fullPath, 'utf8');
const appSource = readFileSync(appPath, 'utf8');
const quotedCodaImage =
  "image: '${CODA_IMAGE:?Set CODA_IMAGE to the exact release name@sha256 manifest digest}'";

assert.deepEqual(comparable(coolifyFull), comparable(canonicalFull));
assert.deepEqual(comparable(coolifyApp), comparable(canonicalApp));
assertHardened(coolifyFull, 'Coolify full-stack topology');
assertHardened(coolifyApp, 'Coolify app-only topology');
assert.deepEqual(Object.keys(coolifyApp.services), ['coda']);
assert.deepEqual(Object.keys(coolifyFull.volumes).sort(), ['minio-data', 'postgres-data']);
assert.equal(coolifyFull.services.minio.expose.includes('9000'), true);
assert.equal(coolifyFull.services.minio.expose.includes('9001'), false);
assert.match(
  fullSource,
  /image: \$\{MINIO_IMAGE:-minio\/minio:[^\r\n]+@sha256:[a-f0-9]{64}\}/u,
  'Coolify full-stack topology must keep the object API independently routable',
);
assert.ok(
  fullSource.includes(quotedCodaImage),
  'Coolify full-stack Coda image interpolation must be quoted for platform parsing',
);
assert.ok(
  appSource.includes(quotedCodaImage),
  'Coolify app-only Coda image interpolation must be quoted for platform parsing',
);
assertEnvironmentTemplate(fullEnvironmentPath);
assertEnvironmentTemplate(appEnvironmentPath);

const documentation = readFileSync(resolve(repositoryRoot, 'docs', 'coolify.md'), 'utf8');
for (const required of [
  'https://coda.example.com:3000',
  'https://objects.example.com:9000',
  'TRUSTED_PROXY_CIDRS',
  'Coolify on Linux AMD64',
  'Coolify on Linux ARM64',
  'Not live-tested',
  'backup',
  'restore',
]) {
  assert.ok(documentation.includes(required), `Coolify documentation omits ${required}`);
}

process.stdout.write(
  'Validated Coolify adapters against canonical full-stack and app-only Compose models.\n',
);
