const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

// Coolify service templates are one-click compose files: operators paste them into the
// Coolify service editor, assign domains, and Coolify fills every SERVICE_* magic
// variable. This validator renders both templates with representative values for those
// magic variables (Coolify generates them at deploy time) and enforces the shared image,
// exposure, hardening, and end-to-end credential-wiring contracts. It mirrors the
// conventions of validate.cjs, including stripping Coolify's `exclude_from_hc` extension
// before handing the file to `docker compose config`.

const repositoryRoot = resolve(__dirname, '..', '..');
const codaVersionImage = 'ghcr.io/kinetik-gg/coda:0.0.4';
const hardenedCodaTmpfs = '/tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777';
const codaDomain = 'coda.example.com';
const minioDomain = 'objects.example.com';

// Representative values Coolify generates for the magic variables, plus the operator
// inputs the app-only template requires. Real deployments never set these by hand.
const magicEnvironment = {
  SERVICE_FQDN_CODA: codaDomain,
  SERVICE_FQDN_CODA_3000: codaDomain,
  SERVICE_FQDN_MINIO: minioDomain,
  SERVICE_FQDN_MINIO_9000: minioDomain,
  SERVICE_PASSWORD_64_SETUPTOKEN: 'S'.repeat(64),
  SERVICE_BASE64_64: 'b'.repeat(64),
  SERVICE_PASSWORD_POSTGRES: 'p'.repeat(16),
  SERVICE_USER_MINIO: 'miniorootuser001',
  SERVICE_PASSWORD_MINIO: 'm'.repeat(19),
  SERVICE_USER_CODAS3: 'codaappaccesskey1',
  SERVICE_PASSWORD_CODAS3: 'k'.repeat(23),
};

const appOperatorEnvironment = {
  DATABASE_URL:
    'postgresql://user:managed-secret@db.example.com:5432/coda?schema=public&sslmode=require&sslaccept=strict',
  S3_ENDPOINT: 'https://s3.example.com',
  S3_PUBLIC_ENDPOINT: 'https://storage.example.com',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'coda',
  S3_ACCESS_KEY: 'external-access-key',
  S3_SECRET_KEY: 'external-secret-key',
  S3_FORCE_PATH_STYLE: 'false',
};

function environmentFor(extra) {
  const environment = { ...process.env, ...magicEnvironment, ...extra };
  delete environment.COMPOSE_FILE;
  delete environment.COMPOSE_PROFILES;
  return environment;
}

function render(path, environment) {
  // Strip Coolify's documented `exclude_from_hc` extension the same way validate.cjs
  // does; `docker compose config` rejects the non-standard key otherwise.
  const source = readFileSync(path, 'utf8');
  const extension = /^    exclude_from_hc: true\r?$/gmu;
  const directory = mkdtempSync(join(tmpdir(), 'coda-coolify-template-'));
  const sanitized = join(directory, 'compose.yaml');
  try {
    writeFileSync(sanitized, source.replace(extension, ''), 'utf8');
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--project-name',
        'coda-coolify-template-validation',
        '-f',
        sanitized,
        'config',
        '--format',
        'json',
      ],
      { cwd: repositoryRoot, encoding: 'utf8', env: environment },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return { config: JSON.parse(result.stdout), source };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function assertHardenedCoda(config, topology) {
  const coda = config.services.coda;
  assert.ok(coda, `${topology} omits Coda`);
  assert.equal(coda.image, codaVersionImage, `${topology} does not pin the release version image`);
  assert.match(
    coda.image,
    /^ghcr\.io\/kinetik-gg\/coda:\d+\.\d+\.\d+$/u,
    `${topology} Coda image is not an immutable version tag`,
  );
  assert.doesNotMatch(coda.image, /@sha256:/u, `${topology} template must stay tag-readable`);
  assert.equal(coda.read_only, true);
  assert.equal(coda.mem_limit, '2147483648');
  assert.equal(coda.memswap_limit, '2684354560');
  assert.equal(coda.pids_limit, 128);
  assert.ok(coda.tmpfs.includes(hardenedCodaTmpfs));
  assert.ok(coda.cap_drop.includes('ALL'));
  assert.ok(coda.security_opt.includes('no-new-privileges:true'));
  assert.ok(coda.expose.includes('3000'));
  assert.ok(coda.healthcheck.test.join(' ').includes('/api/v1/health/ready'));
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal(service.ports, undefined, `${topology} publishes ${name} directly`);
  }
}

function assertServiceLimits(config, topology, serviceName, memory, memorySwap, pids) {
  const service = config.services[serviceName];
  assert.ok(service, `${topology} omits ${serviceName}`);
  assert.equal(service.mem_limit, memory);
  assert.equal(service.memswap_limit, memorySwap);
  assert.equal(service.pids_limit, pids);
}

function assertMetadataHeader(source, name, requiredPort) {
  for (const field of ['# documentation:', '# slogan:', '# tags:', '# port:', '# minversion:']) {
    assert.ok(source.includes(field), `${name} template omits the ${field} metadata header`);
  }
  assert.match(
    source,
    new RegExp(`^# port: ${requiredPort}$`, 'mu'),
    `${name} declares the wrong primary port`,
  );
}

function assertNoMutableTags(source, name) {
  assert.doesNotMatch(
    source,
    /:latest(?:\s|$|@)/u,
    `${name} template references a mutable :latest tag`,
  );
}

function assertMagicWiring(source, name) {
  assert.ok(
    source.includes('SETUP_TOKEN=$SERVICE_PASSWORD_64_SETUPTOKEN'),
    `${name} does not pre-set SETUP_TOKEN from a magic password variable`,
  );
  assert.ok(
    source.includes('CONFIG_ENCRYPTION_KEY=$SERVICE_BASE64_64'),
    `${name} does not generate CONFIG_ENCRYPTION_KEY from a magic variable`,
  );
  assert.ok(source.includes('SERVICE_FQDN_CODA_3000'), `${name} does not allocate the Coda domain`);
  assert.ok(
    source.includes('APP_ORIGIN=https://$SERVICE_FQDN_CODA'),
    `${name} does not derive APP_ORIGIN from the Coda FQDN`,
  );
  assert.ok(source.includes('TRUSTED_PROXY_CIDRS=auto'), `${name} does not use auto proxy trust`);
}

function codaEnv(config) {
  return config.services.coda.environment;
}

// ---------------------------------------------------------------------------
// coda (app-only headline template)
// ---------------------------------------------------------------------------
const appPath = resolve(__dirname, 'templates', 'coda.yaml');
const { config: app, source: appSource } = render(appPath, environmentFor(appOperatorEnvironment));

assertMetadataHeader(appSource, 'coda', 3000);
assertNoMutableTags(appSource, 'coda');
assertMagicWiring(appSource, 'coda');
assertHardenedCoda(app, 'coda app-only template');
assert.deepEqual(Object.keys(app.services), ['coda'], 'app-only template bundles extra services');

const appEnv = codaEnv(app);
assert.equal(appEnv.TRUSTED_PROXY_CIDRS, 'auto');
assert.equal(appEnv.APP_ORIGIN, `https://${codaDomain}`, 'APP_ORIGIN is not derived from the FQDN');
assert.equal(
  appEnv.DATABASE_URL,
  appOperatorEnvironment.DATABASE_URL,
  'operator DATABASE_URL is dropped',
);
assert.equal(appEnv.S3_ENDPOINT, appOperatorEnvironment.S3_ENDPOINT);
assert.equal(appEnv.S3_PUBLIC_ENDPOINT, appOperatorEnvironment.S3_PUBLIC_ENDPOINT);
assert.equal(appEnv.S3_BUCKET, appOperatorEnvironment.S3_BUCKET);
assert.equal(appEnv.S3_ACCESS_KEY, appOperatorEnvironment.S3_ACCESS_KEY);
assert.equal(appEnv.S3_SECRET_KEY, appOperatorEnvironment.S3_SECRET_KEY);
assert.equal(appEnv.S3_FORCE_PATH_STYLE, 'false');
assert.ok(appEnv.SETUP_TOKEN.length >= 32, 'SETUP_TOKEN must be at least 32 characters');
assert.ok(
  Buffer.from(appEnv.CONFIG_ENCRYPTION_KEY, 'base64').length >= 32,
  'CONFIG_ENCRYPTION_KEY must decode to at least 32 bytes',
);
assert.notEqual(
  new URL(appEnv.APP_ORIGIN).origin,
  new URL(appEnv.S3_PUBLIC_ENDPOINT).origin,
  'APP_ORIGIN and S3_PUBLIC_ENDPOINT must be different origins',
);

// ---------------------------------------------------------------------------
// coda-complete (bundled fallback template)
// ---------------------------------------------------------------------------
const completePath = resolve(__dirname, 'templates', 'coda-complete.yaml');
const { config: complete, source: completeSource } = render(completePath, environmentFor({}));

assertMetadataHeader(completeSource, 'coda-complete', 3000);
assertNoMutableTags(completeSource, 'coda-complete');
assertMagicWiring(completeSource, 'coda-complete');
assertHardenedCoda(complete, 'coda-complete template');
assert.deepEqual(
  Object.keys(complete.services).sort(),
  ['coda', 'minio', 'minio-init', 'minio-permissions', 'postgres'],
  'coda-complete does not bundle the full stack',
);
assert.deepEqual(
  Object.keys(complete.volumes).sort(),
  ['minio-data', 'postgres-data'],
  'coda-complete does not declare the persistent volumes',
);
assertServiceLimits(complete, 'coda-complete', 'postgres', '1073741824', '1342177280', 192);
assertServiceLimits(complete, 'coda-complete', 'minio', '1610612736', '2147483648', 128);

// exclude_from_hc extension present for exactly the two one-shot services.
assert.equal(
  (completeSource.match(/^    exclude_from_hc: true\r?$/gmu) ?? []).length,
  2,
  'coda-complete must mark both one-shot services with exclude_from_hc',
);

// Object storage hardening parity with the canonical adapters.
assert.equal(complete.services.minio.user, '1000:1000');
assert.ok(complete.services.minio.expose.includes('9000'));
assert.ok(!complete.services.minio.expose.includes('9001'), 'MinIO console must not be exposed');
assert.ok(
  complete.services.minio.command.join(' ').includes('--console-address 127.0.0.1:9001'),
  'MinIO administration must bind to loopback',
);
assert.equal(complete.services['minio-permissions'].user, '0:0');
assert.ok(complete.services['minio-permissions'].cap_drop.includes('ALL'));
assert.ok(complete.services['minio-permissions'].cap_add.includes('CHOWN'));
assert.equal(
  complete.services.minio.depends_on['minio-permissions'].condition,
  'service_completed_successfully',
);

// End-to-end credential wiring: every generated secret reaches the services that need it,
// with a single consistent value (Coolify reuses each magic variable).
const completeEnv = codaEnv(complete);
const postgresPassword = complete.services.postgres.environment.POSTGRES_PASSWORD;
assert.equal(postgresPassword, magicEnvironment.SERVICE_PASSWORD_POSTGRES);
assert.equal(
  completeEnv.DATABASE_URL,
  `postgresql://coda:${postgresPassword}@postgres:5432/coda?schema=public`,
  'coda-complete does not wire the generated PostgreSQL password into DATABASE_URL',
);
assert.equal(completeEnv.TRUSTED_PROXY_CIDRS, 'auto');
assert.equal(completeEnv.APP_ORIGIN, `https://${codaDomain}`);
assert.equal(
  completeEnv.S3_ENDPOINT,
  'http://minio:9000',
  'coda-complete must reach MinIO in-cluster',
);
assert.equal(completeEnv.S3_PUBLIC_ENDPOINT, `https://${minioDomain}`);
assert.equal(completeEnv.S3_FORCE_PATH_STYLE, 'true');

const initEnv = complete.services['minio-init'].environment;
const minioEnv = complete.services.minio.environment;
assert.equal(minioEnv.MINIO_ROOT_USER, initEnv.MINIO_ROOT_USER, 'MinIO root user is inconsistent');
assert.equal(
  minioEnv.MINIO_ROOT_PASSWORD,
  initEnv.MINIO_ROOT_PASSWORD,
  'MinIO root password is inconsistent',
);
assert.equal(
  completeEnv.S3_ACCESS_KEY,
  initEnv.S3_ACCESS_KEY,
  'bucket-scoped access key differs between Coda and the MinIO bootstrap',
);
assert.equal(
  completeEnv.S3_SECRET_KEY,
  initEnv.S3_SECRET_KEY,
  'bucket-scoped secret key differs between Coda and the MinIO bootstrap',
);
assert.equal(
  minioEnv.MINIO_API_CORS_ALLOW_ORIGIN,
  completeEnv.APP_ORIGIN,
  'MinIO CORS origin must equal the Coda APP_ORIGIN',
);
assert.notEqual(
  new URL(completeEnv.APP_ORIGIN).origin,
  new URL(completeEnv.S3_PUBLIC_ENDPOINT).origin,
  'APP_ORIGIN and S3_PUBLIC_ENDPOINT must be different origins',
);
assert.ok(completeEnv.SETUP_TOKEN.length >= 32, 'SETUP_TOKEN must be at least 32 characters');
assert.ok(
  Buffer.from(completeEnv.CONFIG_ENCRYPTION_KEY, 'base64').length >= 32,
  'CONFIG_ENCRYPTION_KEY must decode to at least 32 bytes',
);

// The two headline services differ only in bundled dependencies: both keep the same
// immutable Coda image and hardened runtime contract.
assert.equal(
  app.services.coda.image,
  complete.services.coda.image,
  'templates use different Coda images',
);

process.stdout.write(
  'Validated Coolify one-click templates (coda app-only and coda-complete) for magic-variable wiring, hardening, and end-to-end credential flow.\n',
);
