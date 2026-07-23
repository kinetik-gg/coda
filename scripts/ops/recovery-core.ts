import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  KeyObject,
} from 'node:crypto';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';

export const RECOVERY_SCHEMA_VERSION = 1;
export const DISPOSABLE_CONFIRMATION_VARIABLE = 'CODA_RECOVERY_DISPOSABLE_PROJECT';
export const RECOVERY_SIGNATURE_ALGORITHM = 'Ed25519';

export function writableBindMountDockerArgs(
  readOnly: boolean,
  userId: number | undefined,
  groupId: number | undefined,
): string[] {
  if (readOnly || userId === undefined || groupId === undefined) return [];
  if (!Number.isInteger(userId) || userId < 0 || !Number.isInteger(groupId) || groupId < 0) {
    throw new Error('Host user and group identifiers must be non-negative integers');
  }
  return ['--user', `${userId}:${groupId}`, '--env', 'HOME=/tmp'];
}

export interface ChecksumRecord {
  bytes: number;
  path: string;
  sha256: string;
}

export interface MigrationRecord {
  checksum: string;
  finishedAt: string;
  name: string;
}

export interface RecoveryManifest {
  schemaVersion: number;
  createdAt: string;
  composeProject: string;
  database: ChecksumRecord & { migrations: MigrationRecord[] };
  image: { digest: string; reference: string };
  authenticity: {
    algorithm: typeof RECOVERY_SIGNATURE_ALGORITHM;
    verificationKeySha256: string;
  };
  objectStorage: {
    bucket: string;
    files: ChecksumRecord[];
    inventorySha256: string;
  };
}

function ed25519PrivateKey(value: string | Buffer): KeyObject {
  const key = createPrivateKey(value);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Recovery signing key must be an Ed25519 private key');
  }
  return key;
}

function ed25519PublicKey(value: string | Buffer): KeyObject {
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Recovery verification key must be an Ed25519 public key');
  }
  return key;
}

export function recoveryVerificationKeySha256(key: string | Buffer | KeyObject): string {
  const publicKey =
    key instanceof KeyObject
      ? key.type === 'public'
        ? key
        : createPublicKey(key)
      : ed25519PublicKey(key);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Recovery verification key must be an Ed25519 public key');
  }
  return createHash('sha256')
    .update(publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex');
}

export function recoverySigningKeyFingerprint(key: string | Buffer): string {
  return recoveryVerificationKeySha256(ed25519PrivateKey(key));
}

export function signRecoveryManifest(contents: Buffer, privateKey: string | Buffer): string {
  return `${sign(null, contents, ed25519PrivateKey(privateKey)).toString('base64')}\n`;
}

export function verifyRecoveryManifestSignature(
  contents: Buffer,
  signatureText: string,
  publicKey: string | Buffer,
): string {
  if (!/^[A-Za-z0-9+/]{86}==\r?\n?$/u.test(signatureText)) {
    throw new Error('Recovery manifest signature is malformed');
  }
  const key = ed25519PublicKey(publicKey);
  const signature = Buffer.from(signatureText.trim(), 'base64');
  if (!verify(null, contents, key, signature)) {
    throw new Error('Recovery manifest signature is invalid');
  }
  return recoveryVerificationKeySha256(key);
}

export function immutableImageDigest(reference: string): string {
  const match = reference.match(/@(?<digest>sha256:[a-f0-9]{64})$/u);
  if (!match?.groups?.digest) {
    throw new Error('Coda image must be an immutable reference ending in @sha256:<64 hex>');
  }
  return match.groups.digest;
}

export function assertSafeProjectName(project: string): void {
  if (!/^(?:coda-)?recovery-[a-z0-9][a-z0-9-]{2,50}$/u.test(project)) {
    throw new Error(
      'Restore targets must use a dedicated recovery-* or coda-recovery-* Compose project name',
    );
  }
}

export function assertDisposableConfirmation(
  project: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  assertSafeProjectName(project);
  if (environment[DISPOSABLE_CONFIRMATION_VARIABLE] !== project) {
    throw new Error(
      `${DISPOSABLE_CONFIRMATION_VARIABLE} must exactly equal the disposable target project`,
    );
  }
}

export function safeRelativePath(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  const path = relative(absoluteRoot, absoluteCandidate);
  if (
    !path ||
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    resolve(absoluteRoot, path) !== absoluteCandidate
  ) {
    throw new Error(`Path must be a child of the recovery directory: ${candidate}`);
  }
  return path.split(sep).join('/');
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function checksumRecord(root: string, path: string): Promise<ChecksumRecord> {
  return {
    bytes: statSync(path).size,
    path: safeRelativePath(root, path),
    sha256: await sha256File(path),
  };
}

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

export async function objectInventory(root: string, directory: string): Promise<ChecksumRecord[]> {
  const records = await Promise.all(
    filesBelow(directory)
      .sort((left, right) => left.localeCompare(right))
      .map((path) => checksumRecord(root, path)),
  );
  return records;
}

export function inventoryChecksum(records: ChecksumRecord[]): string {
  const canonical = records
    .map(({ bytes, path, sha256 }) => `${sha256}  ${bytes}  ${path}\n`)
    .join('');
  return createHash('sha256').update(canonical).digest('hex');
}

export function parseMigrations(output: string): MigrationRecord[] {
  return output
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [name, checksum, finishedAt, extra] = line.split('\t');
      if (!name || !checksum || !finishedAt || extra !== undefined) {
        throw new Error('PostgreSQL returned an invalid migration-state record');
      }
      return { name, checksum, finishedAt };
    });
}

export function referencedObjectsMissing(
  databaseKeys: string[],
  files: ChecksumRecord[],
): string[] {
  const objectPrefix = 'objects/';
  const storedKeys = new Set<string>(
    files
      .map(({ path }) => (path.startsWith(objectPrefix) ? path.slice(objectPrefix.length) : path))
      .filter(Boolean),
  );
  const uniqueKeys = databaseKeys.filter((key, index) => databaseKeys.indexOf(key) === index);
  return uniqueKeys.filter((key) => !storedKeys.has(key)).sort();
}

export function assertConfiguredImage(config: unknown, expected: string): void {
  if (!config || typeof config !== 'object' || !('services' in config)) {
    throw new Error('Docker Compose returned an invalid configuration');
  }
  const services = (config as { services?: unknown }).services;
  if (!services || typeof services !== 'object' || !('coda' in services)) {
    throw new Error('Docker Compose configuration does not contain Coda');
  }
  const coda = (services as { coda?: unknown }).coda;
  const image = coda && typeof coda === 'object' && 'image' in coda ? coda.image : undefined;
  if (image !== expected) {
    throw new Error('Configured Coda image does not match the recovery manifest');
  }
}

export function inventoryMismatches(
  expected: ChecksumRecord[],
  actual: ChecksumRecord[],
): string[] {
  const actualByPath = new Map(actual.map((record) => [record.path, record]));
  const mismatches = expected.flatMap((record) => {
    const found = actualByPath.get(record.path);
    return !found || found.bytes !== record.bytes || found.sha256 !== record.sha256
      ? [record.path]
      : [];
  });
  const expectedPaths = new Set(expected.map(({ path }) => path));
  return [
    ...mismatches,
    ...actual.filter(({ path }) => !expectedPaths.has(path)).map(({ path }) => path),
  ]
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
}

export function validateManifest(value: unknown): RecoveryManifest {
  if (!value || typeof value !== 'object') throw new Error('Recovery manifest must be an object');
  const manifest = value as Partial<RecoveryManifest>;
  if (manifest.schemaVersion !== RECOVERY_SCHEMA_VERSION) {
    throw new Error(`Unsupported recovery manifest schema: ${String(manifest.schemaVersion)}`);
  }
  if (!manifest.createdAt || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('Recovery manifest has an invalid timestamp');
  }
  if (
    !manifest.composeProject ||
    !manifest.database ||
    !manifest.image ||
    !manifest.authenticity ||
    !manifest.objectStorage
  ) {
    throw new Error('Recovery manifest is incomplete');
  }
  if (
    manifest.authenticity.algorithm !== RECOVERY_SIGNATURE_ALGORITHM ||
    !/^[a-f0-9]{64}$/u.test(manifest.authenticity.verificationKeySha256 ?? '')
  ) {
    throw new Error('Recovery manifest has invalid authenticity metadata');
  }
  immutableImageDigest(manifest.image.reference);
  if (manifest.image.digest !== immutableImageDigest(manifest.image.reference)) {
    throw new Error('Recovery manifest image digest does not match its image reference');
  }
  if (manifest.database.path !== 'database.dump') {
    throw new Error('Recovery database dump must use the canonical database.dump path');
  }
  for (const record of manifest.objectStorage.files) {
    if (
      !record.path.startsWith('objects/') ||
      record.path.includes('\\') ||
      posix.isAbsolute(record.path) ||
      posix.normalize(record.path) !== record.path
    ) {
      throw new Error(`Recovery object has a non-canonical path: ${record.path}`);
    }
  }
  return manifest as RecoveryManifest;
}
