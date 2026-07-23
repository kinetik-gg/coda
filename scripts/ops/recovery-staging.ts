import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  inventoryChecksum,
  recoveryVerificationKeySha256,
  safeRelativePath,
  validateManifest,
  verifyRecoveryManifestSignature,
  type ChecksumRecord,
  type RecoveryManifest,
} from './recovery-core';

const MANIFEST_FILE = 'manifest.json';
const MANIFEST_SIGNATURE_FILE = 'manifest.sig';
const OBJECT_DIRECTORY = 'objects';
const MAX_KEY_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 4096;
const READ_BUFFER_BYTES = 64 * 1024;

interface OpenedRegularFile {
  descriptor: number;
  size: number;
}

export interface StagedRecovery {
  directory: string;
  manifest: RecoveryManifest;
  dispose(): void;
}

function operationRefused(message: string): Error {
  return new Error(`Recovery operation refused: ${message}`);
}

function noFollowReadFlags(): number {
  return constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
}

function openRegularFileNoFollow(path: string): OpenedRegularFile {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw operationRefused(`backup input is not a regular file: ${path}`);
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, noFollowReadFlags());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw operationRefused(`backup input changed while opening: ${path}`);
    }
    return { descriptor, size: opened.size };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

export function readRegularFileNoFollow(path: string, maximumBytes: number): Buffer {
  const { descriptor, size } = openRegularFileNoFollow(path);
  try {
    if (size > maximumBytes) throw operationRefused(`backup input is too large: ${path}`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_BUFFER_BYTES, maximumBytes - total + 1));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) throw operationRefused(`backup input is too large: ${path}`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}

function writePrivateFile(path: string, contents: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    let offset = 0;
    while (offset < contents.length) {
      offset += writeSync(descriptor, contents, offset, contents.length - offset);
    }
  } finally {
    closeSync(descriptor);
  }
}

function stageRecord(sourceRoot: string, stagingRoot: string, record: ChecksumRecord): void {
  const source = resolve(sourceRoot, record.path);
  if (safeRelativePath(sourceRoot, source) !== record.path) {
    throw operationRefused(`manifest path is not canonical: ${record.path}`);
  }
  const destination = resolve(stagingRoot, record.path);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const input = openRegularFileNoFollow(source);
  const output = openSync(
    destination,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const chunk = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    while (true) {
      const bytesRead = readSync(input.descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > record.bytes) {
        throw operationRefused(`checksum mismatch for ${record.path}`);
      }
      hash.update(chunk.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) {
        offset += writeSync(output, chunk, offset, bytesRead - offset);
      }
    }
  } finally {
    closeSync(output);
    closeSync(input.descriptor);
  }
  if (bytes !== record.bytes || hash.digest('hex') !== record.sha256) {
    throw operationRefused(`checksum mismatch for ${record.path}`);
  }
}

function regularFilesBelow(root: string, directory: string): string[] {
  const status = lstatSync(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw operationRefused(`backup object path is not a directory: ${directory}`);
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    const entryStatus = lstatSync(path);
    if (entryStatus.isSymbolicLink()) {
      throw operationRefused(`backup object path is a symbolic link: ${path}`);
    }
    if (entryStatus.isDirectory()) return regularFilesBelow(root, path);
    if (!entryStatus.isFile()) {
      throw operationRefused(`backup object path is not a regular file: ${path}`);
    }
    return [safeRelativePath(root, path)];
  });
}

function assertObjectSet(sourceRoot: string, manifest: RecoveryManifest): void {
  const expected = manifest.objectStorage.files.map(({ path }) => path).sort();
  const actual = regularFilesBelow(sourceRoot, resolve(sourceRoot, OBJECT_DIRECTORY)).sort();
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const mismatches = [
    ...expected.filter((path) => !actualSet.has(path)),
    ...actual.filter((path) => !expectedSet.has(path)),
  ];
  if (mismatches.length > 0) {
    throw operationRefused(
      `backup object inventory differs from the signed manifest: ${mismatches.join(', ')}`,
    );
  }
}

function authenticManifest(
  sourceRoot: string,
  verificationKeyPath: string,
): {
  contents: Buffer;
  manifest: RecoveryManifest;
  signature: Buffer;
} {
  const key = readRegularFileNoFollow(verificationKeyPath, MAX_KEY_BYTES);
  const contents = readRegularFileNoFollow(resolve(sourceRoot, MANIFEST_FILE), MAX_MANIFEST_BYTES);
  let signature: Buffer;
  try {
    signature = readRegularFileNoFollow(
      resolve(sourceRoot, MANIFEST_SIGNATURE_FILE),
      MAX_SIGNATURE_BYTES,
    );
  } catch {
    throw operationRefused('signed recovery manifest is required');
  }
  const keyFingerprint = verifyRecoveryManifestSignature(contents, signature.toString('utf8'), key);
  const manifest = validateManifest(JSON.parse(contents.toString('utf8')));
  if (
    manifest.authenticity.verificationKeySha256 !== keyFingerprint ||
    recoveryVerificationKeySha256(key) !== keyFingerprint
  ) {
    throw operationRefused('recovery verification key does not match the signed manifest');
  }
  return { contents, manifest, signature };
}

function createPrivateStagingDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coda-recovery-stage-'));
  chmodSync(directory, 0o700);
  return directory;
}

export function stageAuthenticRecovery(
  sourceDirectory: string,
  verificationKeyPath: string,
): StagedRecovery {
  const sourceRoot = resolve(sourceDirectory);
  const stagingRoot = createPrivateStagingDirectory();
  try {
    const { contents, manifest, signature } = authenticManifest(sourceRoot, verificationKeyPath);
    if (
      inventoryChecksum(manifest.objectStorage.files) !== manifest.objectStorage.inventorySha256
    ) {
      throw operationRefused('object inventory checksum is invalid');
    }
    assertObjectSet(sourceRoot, manifest);
    writePrivateFile(resolve(stagingRoot, MANIFEST_FILE), contents);
    writePrivateFile(resolve(stagingRoot, MANIFEST_SIGNATURE_FILE), signature);
    stageRecord(sourceRoot, stagingRoot, manifest.database);
    for (const record of manifest.objectStorage.files) {
      stageRecord(sourceRoot, stagingRoot, record);
    }
    return {
      directory: stagingRoot,
      manifest,
      dispose: () => rmSync(stagingRoot, { force: true, recursive: true }),
    };
  } catch (error) {
    rmSync(stagingRoot, { force: true, recursive: true });
    throw error;
  }
}
