import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import {
  DISPOSABLE_CONFIRMATION_VARIABLE,
  RECOVERY_SCHEMA_VERSION,
  RECOVERY_SIGNATURE_ALGORITHM,
  assertConfiguredImage,
  assertDisposableConfirmation,
  checksumRecord,
  immutableImageDigest,
  inventoryChecksum,
  inventoryMismatches,
  objectInventory,
  parseMigrations,
  referencedObjectsMissing,
  recoverySigningKeyFingerprint,
  safeRelativePath,
  sha256File,
  signRecoveryManifest,
  validateManifest,
  verifyRecoveryManifestSignature,
  writableBindMountDockerArgs,
  type RecoveryManifest,
} from './recovery-core';

const MINIO_CLIENT_IMAGE =
  'minio/mc:RELEASE.2025-07-21T05-28-08Z@sha256:fb8f773eac8ef9d6da0486d5dec2f42f219358bcb8de579d1623d518c9ebd4cc';
const DATABASE_DUMP = 'database.dump';
const OBJECT_DIRECTORY = 'objects';
const MANIFEST_FILE = 'manifest.json';
const MANIFEST_SIGNATURE_FILE = 'manifest.sig';

interface Options {
  command: string;
  project: string;
  composeFiles: string[];
  envFile: string;
  recoveryDirectory: string;
  image: string;
  signingKey: string;
  verificationKey: string;
}

function fail(message: string): never {
  throw new Error(`Recovery operation refused: ${message}`);
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown recovery error';
}

function parseOptions(argv: string[]): Options {
  const command = argv.shift();
  if (!command || !['backup', 'restore', 'smoke', 'verify', 'reset'].includes(command)) {
    fail('expected backup, restore, smoke, verify, or reset');
  }
  const values = new Map<string, string[]>();
  while (argv.length > 0) {
    const flag = argv.shift();
    const value = argv.shift();
    if (!flag?.startsWith('--') || !value) fail(`invalid argument near ${flag ?? '<end>'}`);
    values.set(flag, [...(values.get(flag) ?? []), value]);
  }
  const one = (flag: string, required = true): string => {
    const entries = values.get(flag) ?? [];
    if (entries.length > 1) fail(`${flag} may only be supplied once`);
    if (!entries[0] && required) fail(`${flag} is required`);
    return entries[0] ?? '';
  };
  const composeFiles = values.get('--compose-file') ?? ['compose.yaml'];
  return {
    command,
    project: one('--project'),
    composeFiles,
    envFile: one('--env-file'),
    recoveryDirectory: one(
      '--recovery-directory',
      command === 'backup' || command === 'restore' || command === 'smoke' || command === 'verify',
    ),
    image: one('--image', command === 'backup' || command === 'smoke'),
    signingKey: one('--signing-key', command === 'backup'),
    verificationKey: one(
      '--verification-key',
      command === 'restore' || command === 'smoke' || command === 'verify',
    ),
  };
}

function assertKeyOutsideRecoveryDirectory(recoveryDirectory: string, keyPath: string): string {
  const requestedDirectory = resolve(recoveryDirectory);
  const directory = existsSync(requestedDirectory)
    ? realpathSync(requestedDirectory)
    : requestedDirectory;
  const key = realpathSync(resolve(keyPath));
  const path = relative(directory, key);
  if (!path || (path !== '..' && !path.startsWith(`..${sep}`))) {
    fail('recovery signing and verification keys must be stored outside the backup directory');
  }
  return key;
}

function commandText(executable: string, args: string[], environment = process.env): string {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) fail(`${executable} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${executable} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function composeArgs(options: Options, args: string[]): string[] {
  return [
    'compose',
    '--project-name',
    options.project,
    '--env-file',
    options.envFile,
    ...options.composeFiles.flatMap((file) => ['-f', file]),
    ...args,
  ];
}

function compose(options: Options, args: string[]): string {
  return commandText('docker', composeArgs(options, args));
}

function serviceContainer(options: Options, service: string, required = true): string {
  const container = compose(options, ['ps', '--all', '--quiet', service]);
  if (required && !container) fail(`Compose service ${service} does not have a container`);
  if (container) {
    const labels = JSON.parse(
      commandText('docker', ['inspect', '--format', '{{json .Config.Labels}}', container]),
    ) as Record<string, string>;
    if (labels['com.docker.compose.project'] !== options.project)
      fail(`${service} is from another project`);
    if (labels['com.docker.compose.service'] !== service) fail(`${service} label does not match`);
  }
  return container;
}

function containerEnvironment(container: string): Record<string, string> {
  const entries = JSON.parse(
    commandText('docker', ['inspect', '--format', '{{json .Config.Env}}', container]),
  ) as string[];
  return Object.fromEntries(
    entries.map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

function postgresText(container: string, database: string, user: string, sql: string): string {
  return commandText('docker', [
    'exec',
    container,
    'psql',
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--field-separator',
    '\t',
    '--dbname',
    database,
    '--username',
    user,
    '--command',
    sql,
  ]);
}

async function streamCommandToFile(
  executable: string,
  args: string[],
  output: string,
): Promise<void> {
  mkdirSync(dirname(output), { recursive: true });
  const descriptor = openSync(output, 'wx', 0o600);
  try {
    await new Promise<void>((accept, reject) => {
      const child = spawn(executable, args, { stdio: ['ignore', descriptor, 'pipe'] });
      let error = '';
      const stderr = child.stderr;
      if (!stderr) return reject(new Error('Recovery command did not expose standard error'));
      stderr.setEncoding('utf8');
      stderr.on('data', (chunk: string) => (error += chunk));
      child.once('error', reject);
      child.once('close', (code) => (code === 0 ? accept() : reject(new Error(error.trim()))));
    });
  } finally {
    closeSync(descriptor);
  }
}

async function streamFileToCommand(
  input: string,
  executable: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (error += chunk));
    createReadStream(input).pipe(child.stdin);
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? accept() : reject(new Error(error.trim()))));
  });
}

function minioRun(
  container: string,
  environment: Record<string, string>,
  mount: string,
  script: string,
  readOnly: boolean,
): string {
  const volume = `${resolve(mount)}:/backup${readOnly ? ':ro' : ''}`;
  const userId = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const groupId = typeof process.getgid === 'function' ? process.getgid() : undefined;
  return commandText(
    'docker',
    [
      'run',
      '--rm',
      ...writableBindMountDockerArgs(readOnly, userId, groupId),
      '--network',
      `container:${container}`,
      '--env',
      'MINIO_ROOT_USER',
      '--env',
      'MINIO_ROOT_PASSWORD',
      '--env',
      'S3_BUCKET',
      '--volume',
      volume,
      '--entrypoint',
      '/bin/sh',
      MINIO_CLIENT_IMAGE,
      '-ec',
      `mc alias set coda http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null\n${script}`,
    ],
    {
      ...process.env,
      MINIO_ROOT_USER: environment.MINIO_ROOT_USER ?? '',
      MINIO_ROOT_PASSWORD: environment.MINIO_ROOT_PASSWORD ?? '',
      S3_BUCKET: environment.S3_BUCKET ?? '',
    },
  );
}

function assertContainerRunning(container: string, service: string): void {
  if (commandText('docker', ['inspect', '--format', '{{.State.Running}}', container]) !== 'true') {
    fail(`${service} container is not running`);
  }
}

function assertRunningImage(container: string, image: string): void {
  immutableImageDigest(image);
  const runningId = commandText('docker', ['inspect', '--format', '{{.Image}}', container]);
  const expectedId = commandText('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
  if (runningId !== expectedId)
    fail('running Coda container does not match the recorded image reference');
}

function assertComposeImage(options: Options, expected: string): void {
  immutableImageDigest(expected);
  assertConfiguredImage(parseJson(compose(options, ['config', '--format', 'json'])), expected);
}

async function liveObjectInventory(minio: string, environment: Record<string, string>) {
  const root = mkdtempSync(resolve(tmpdir(), 'coda-recovery-live-'));
  const objects = resolve(root, OBJECT_DIRECTORY);
  mkdirSync(objects, { mode: 0o700 });
  try {
    minioRun(minio, environment, objects, 'mc mirror "coda/$S3_BUCKET" /backup', false);
    return await objectInventory(root, objects);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

async function assertLiveObjects(
  minio: string,
  environment: Record<string, string>,
  expected: RecoveryManifest['objectStorage']['files'],
): Promise<void> {
  const mismatches = inventoryMismatches(expected, await liveObjectInventory(minio, environment));
  if (mismatches.length > 0) {
    fail(`live object storage differs from the backup: ${mismatches.join(', ')}`);
  }
}

function migrationState(postgres: string, database: string, user: string) {
  return parseMigrations(
    postgresText(
      postgres,
      database,
      user,
      `SELECT migration_name, checksum, finished_at::text FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    ),
  );
}

function databaseObjectKeys(postgres: string, database: string, user: string): string[] {
  const exists = postgresText(
    postgres,
    database,
    user,
    `SELECT to_regclass('public.storage_objects') IS NOT NULL`,
  );
  if (exists !== 't') return [];
  return postgresText(
    postgres,
    database,
    user,
    `SELECT object_key FROM storage_objects WHERE status = 'READY' ORDER BY object_key`,
  )
    .split(/\r?\n/u)
    .filter(Boolean);
}

function awaitReadiness(coda: string): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('docker', [
      'exec',
      coda,
      'wget',
      '-q',
      '-O',
      '/dev/null',
      'http://127.0.0.1:3000/api/v1/health/ready',
    ]);
    if (result.status === 0) return;
    spawnSync(
      process.platform === 'win32' ? 'powershell' : 'sleep',
      process.platform === 'win32' ? ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2'] : ['2'],
    );
  }
  fail('Coda did not become ready within 120 seconds');
}

async function verifyFiles(directory: string, manifest: RecoveryManifest): Promise<void> {
  const expected = [manifest.database, ...manifest.objectStorage.files];
  for (const record of expected) {
    const path = resolve(directory, record.path);
    if (safeRelativePath(directory, path) !== record.path) {
      fail(`manifest path is not canonical: ${record.path}`);
    }
    if ((await sha256File(path)) !== record.sha256) fail(`checksum mismatch for ${record.path}`);
  }
  if (inventoryChecksum(manifest.objectStorage.files) !== manifest.objectStorage.inventorySha256) {
    fail('object inventory checksum is invalid');
  }
  const actualObjects = await objectInventory(directory, resolve(directory, OBJECT_DIRECTORY));
  const mismatches = inventoryMismatches(manifest.objectStorage.files, actualObjects);
  if (mismatches.length > 0) {
    fail(`backup object inventory differs from the signed manifest: ${mismatches.join(', ')}`);
  }
}

function readAuthenticManifest(directory: string, verificationKeyPath: string): RecoveryManifest {
  const keyPath = assertKeyOutsideRecoveryDirectory(directory, verificationKeyPath);
  const key = readFileSync(keyPath);
  const contents = readFileSync(resolve(directory, MANIFEST_FILE));
  let signature: string;
  try {
    signature = readFileSync(resolve(directory, MANIFEST_SIGNATURE_FILE), 'utf8');
  } catch {
    fail('signed recovery manifest is required');
  }
  const keyFingerprint = verifyRecoveryManifestSignature(contents, signature, key);
  const manifest = validateManifest(JSON.parse(contents.toString('utf8')));
  if (manifest.authenticity.verificationKeySha256 !== keyFingerprint) {
    fail('recovery verification key does not match the signed manifest');
  }
  return manifest;
}

async function backup(options: Options): Promise<void> {
  const directory = resolve(options.recoveryDirectory);
  const signingKeyPath = assertKeyOutsideRecoveryDirectory(directory, options.signingKey);
  const signingKey = readFileSync(signingKeyPath);
  const verificationKeySha256 = recoverySigningKeyFingerprint(signingKey);
  const dumpPath = resolve(directory, DATABASE_DUMP);
  const objects = resolve(directory, OBJECT_DIRECTORY);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  mkdirSync(objects, { mode: 0o700 });
  const coda = serviceContainer(options, 'coda');
  const postgres = serviceContainer(options, 'postgres');
  const minio = serviceContainer(options, 'minio');
  assertContainerRunning(coda, 'Coda');
  assertContainerRunning(postgres, 'PostgreSQL');
  assertContainerRunning(minio, 'MinIO');
  assertRunningImage(coda, options.image);
  const codaEnv = containerEnvironment(coda);
  const bucket = codaEnv.S3_BUCKET;
  if (!bucket) fail('Coda container does not define S3_BUCKET');
  const minioEnv = { ...containerEnvironment(minio), S3_BUCKET: bucket };
  const database = containerEnvironment(postgres).POSTGRES_DB ?? 'coda';
  const user = containerEnvironment(postgres).POSTGRES_USER ?? 'coda';
  commandText('docker', ['stop', coda]);
  try {
    const migrations = migrationState(postgres, database, user);
    const keys = databaseObjectKeys(postgres, database, user);
    await streamCommandToFile(
      'docker',
      [
        'exec',
        postgres,
        'pg_dump',
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        database,
        '--username',
        user,
      ],
      dumpPath,
    );
    minioRun(minio, minioEnv, objects, 'mc mirror --overwrite "coda/$S3_BUCKET" /backup', false);
    const files = await objectInventory(directory, objects);
    const missing = referencedObjectsMissing(keys, files);
    if (missing.length > 0) fail(`database references missing objects: ${missing.join(', ')}`);
    const imageDigest = immutableImageDigest(options.image);
    const manifest: RecoveryManifest = {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      composeProject: options.project,
      database: { ...(await checksumRecord(directory, dumpPath)), migrations },
      image: { digest: imageDigest, reference: options.image },
      authenticity: {
        algorithm: RECOVERY_SIGNATURE_ALGORITHM,
        verificationKeySha256,
      },
      objectStorage: {
        bucket,
        files,
        inventorySha256: inventoryChecksum(files),
      },
    };
    const manifestContents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeFileSync(resolve(directory, MANIFEST_FILE), manifestContents, {
      flag: 'wx',
      mode: 0o600,
    });
    writeFileSync(
      resolve(directory, MANIFEST_SIGNATURE_FILE),
      signRecoveryManifest(manifestContents, signingKey),
      { flag: 'wx', mode: 0o600 },
    );
  } finally {
    commandText('docker', ['start', coda]);
    awaitReadiness(coda);
  }
}

function assertEmptyTarget(
  postgres: string,
  minio: string,
  database: string,
  user: string,
  environment: Record<string, string>,
): void {
  const tableCount = postgresText(
    postgres,
    database,
    user,
    `SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'`,
  );
  if (tableCount !== '0') fail('target PostgreSQL database contains user tables');
  const emptyMount = mkdtempSync(resolve(tmpdir(), 'coda-recovery-empty-'));
  try {
    const output = minioRun(
      minio,
      environment,
      emptyMount,
      'mc ls --recursive "coda/$S3_BUCKET"',
      true,
    );
    if (output.trim()) fail('target object-storage bucket is not empty');
  } finally {
    rmSync(emptyMount, { force: true, recursive: true });
  }
}

async function restore(options: Options): Promise<void> {
  assertDisposableConfirmation(options.project);
  const directory = resolve(options.recoveryDirectory);
  const manifest = readAuthenticManifest(directory, options.verificationKey);
  await verifyFiles(directory, manifest);
  const postgres = serviceContainer(options, 'postgres');
  const minio = serviceContainer(options, 'minio');
  const coda = serviceContainer(options, 'coda', false);
  if (coda) fail('target Coda service must not have a container before restore');
  const postgresEnv = containerEnvironment(postgres);
  const database = postgresEnv.POSTGRES_DB ?? 'coda';
  const user = postgresEnv.POSTGRES_USER ?? 'coda';
  const minioEnv = { ...containerEnvironment(minio), S3_BUCKET: manifest.objectStorage.bucket };
  assertComposeImage(options, manifest.image.reference);
  assertEmptyTarget(postgres, minio, database, user, minioEnv);
  await streamFileToCommand(resolve(directory, manifest.database.path), 'docker', [
    'exec',
    '--interactive',
    postgres,
    'pg_restore',
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    database,
    '--username',
    user,
  ]);
  minioRun(
    minio,
    minioEnv,
    resolve(directory, OBJECT_DIRECTORY),
    'mc mirror --overwrite /backup "coda/$S3_BUCKET"',
    true,
  );
  await assertLiveObjects(minio, minioEnv, manifest.objectStorage.files);
  compose(options, ['up', '--detach', '--no-deps', 'coda']);
  const restoredCoda = serviceContainer(options, 'coda');
  assertRunningImage(restoredCoda, manifest.image.reference);
  awaitReadiness(restoredCoda);
  const restoredMigrations = migrationState(postgres, database, user);
  if (JSON.stringify(restoredMigrations) !== JSON.stringify(manifest.database.migrations)) {
    fail('restored migration state differs from the backup');
  }
  const missing = referencedObjectsMissing(
    databaseObjectKeys(postgres, database, user),
    manifest.objectStorage.files,
  );
  if (missing.length > 0)
    fail(`restored database references missing objects: ${missing.join(', ')}`);
  const setupStatus = commandText('docker', [
    'exec',
    restoredCoda,
    'wget',
    '-q',
    '-O',
    '-',
    'http://127.0.0.1:3000/api/v1/setup/status',
  ]);
  const evidenceTimestamp = new Date().toISOString().replace(/:/gu, '-');
  writeFileSync(
    resolve(directory, `restore-${options.project}-${evidenceTimestamp}.json`),
    `${JSON.stringify(
      {
        validatedAt: new Date().toISOString(),
        project: options.project,
        image: manifest.image,
        migrations: restoredMigrations,
        referencedObjects: manifest.objectStorage.files.length,
        readiness: 'passed',
        productSmoke: parseJson(setupStatus),
      },
      null,
      2,
    )}\n`,
    { flag: 'wx', mode: 0o600 },
  );
}

async function smoke(options: Options): Promise<void> {
  const directory = resolve(options.recoveryDirectory);
  const manifest = readAuthenticManifest(directory, options.verificationKey);
  await verifyFiles(directory, manifest);
  const postgres = serviceContainer(options, 'postgres');
  const minio = serviceContainer(options, 'minio');
  const coda = serviceContainer(options, 'coda');
  assertRunningImage(coda, options.image);
  awaitReadiness(coda);
  const postgresEnv = containerEnvironment(postgres);
  const database = postgresEnv.POSTGRES_DB ?? 'coda';
  const user = postgresEnv.POSTGRES_USER ?? 'coda';
  const minioEnv = {
    ...containerEnvironment(minio),
    S3_BUCKET: manifest.objectStorage.bucket,
  };
  const currentMigrations = migrationState(postgres, database, user);
  const completedNames = new Set(currentMigrations.map(({ name }) => name));
  const missingMigrations = manifest.database.migrations.filter(
    ({ name }) => !completedNames.has(name),
  );
  if (missingMigrations.length > 0) fail('upgrade lost migrations recorded in the source backup');
  const missingObjects = referencedObjectsMissing(
    databaseObjectKeys(postgres, database, user),
    manifest.objectStorage.files,
  );
  if (missingObjects.length > 0)
    fail(`database references missing objects: ${missingObjects.join(', ')}`);
  await assertLiveObjects(minio, minioEnv, manifest.objectStorage.files);
  const setupStatus = commandText('docker', [
    'exec',
    coda,
    'wget',
    '-q',
    '-O',
    '-',
    'http://127.0.0.1:3000/api/v1/setup/status',
  ]);
  const evidenceTimestamp = new Date().toISOString().replace(/:/gu, '-');
  const digest = immutableImageDigest(options.image).slice('sha256:'.length, 'sha256:'.length + 12);
  writeFileSync(
    resolve(directory, `smoke-${options.project}-${digest}-${evidenceTimestamp}.json`),
    `${JSON.stringify(
      {
        validatedAt: new Date().toISOString(),
        project: options.project,
        image: { digest: immutableImageDigest(options.image), reference: options.image },
        migrations: currentMigrations,
        referencedObjects: manifest.objectStorage.files.length,
        readiness: 'passed',
        productSmoke: parseJson(setupStatus),
      },
      null,
      2,
    )}\n`,
    { flag: 'wx', mode: 0o600 },
  );
}

async function verify(options: Options): Promise<void> {
  const directory = resolve(options.recoveryDirectory);
  await verifyFiles(directory, readAuthenticManifest(directory, options.verificationKey));
}

function reset(options: Options): void {
  assertDisposableConfirmation(options.project);
  compose(options, ['down', '--volumes', '--remove-orphans']);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === 'backup') await backup(options);
  if (options.command === 'restore') await restore(options);
  if (options.command === 'smoke') await smoke(options);
  if (options.command === 'verify') await verify(options);
  if (options.command === 'reset') reset(options);
  process.stdout.write(`Recovery ${options.command} completed for ${options.project}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.stderr.write(
    `Destructive targets require ${DISPOSABLE_CONFIRMATION_VARIABLE}=<exact-project>.\n`,
  );
  process.exitCode = 1;
});
