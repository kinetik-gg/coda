import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertConfiguredImage,
  assertDisposableConfirmation,
  immutableImageDigest,
  inventoryChecksum,
  inventoryMismatches,
  objectInventory,
  parseMigrations,
  referencedObjectsMissing,
  recoverySigningKeyFingerprint,
  recoveryVerificationKeySha256,
  safeRelativePath,
  signRecoveryManifest,
  validateManifest,
  verifyRecoveryManifestSignature,
  writableBindMountDockerArgs,
} from './recovery-core';

const digest = `sha256:${'a'.repeat(64)}`;

describe('recovery guardrails', () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const path of temporary.splice(0)) {
      rmSync(path, { force: true, recursive: true });
    }
  });

  it('accepts only immutable image references', () => {
    expect(immutableImageDigest(`ghcr.io/kinetik-gg/coda@${digest}`)).toBe(digest);
    expect(() => immutableImageDigest('ghcr.io/kinetik-gg/coda:v0.0.2')).toThrow(/immutable/u);
  });

  it('writes bind-mounted recovery files as the host user', () => {
    expect(writableBindMountDockerArgs(false, 1001, 1002)).toEqual([
      '--user',
      '1001:1002',
      '--env',
      'HOME=/tmp',
    ]);
    expect(writableBindMountDockerArgs(true, 1001, 1002)).toEqual([]);
    expect(writableBindMountDockerArgs(false, undefined, undefined)).toEqual([]);
    expect(() => writableBindMountDockerArgs(false, -1, 1002)).toThrow(/non-negative/u);
  });

  it('requires a recovery project and exact environment confirmation', () => {
    expect(() =>
      assertDisposableConfirmation('coda-recovery-pr-42', {
        CODA_RECOVERY_DISPOSABLE_PROJECT: 'coda-recovery-pr-42',
      }),
    ).not.toThrow();
    expect(() =>
      assertDisposableConfirmation('production', {
        CODA_RECOVERY_DISPOSABLE_PROJECT: 'production',
      }),
    ).toThrow(/recovery/u);
    expect(() => assertDisposableConfirmation('coda-recovery-pr-42', {})).toThrow(/exactly/u);
  });

  it('rejects files outside the evidence directory', () => {
    expect(safeRelativePath('/backup/run', '/backup/run/database.dump')).toBe('database.dump');
    expect(() => safeRelativePath('/backup/run', '/backup/other.dump')).toThrow(/child/u);
  });

  it('creates a stable object inventory and detects missing references', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coda-recovery-test-'));
    const objects = join(root, 'objects');
    temporary.push(root);
    mkdirSync(join(objects, 'project'), { recursive: true });
    writeFileSync(join(objects, 'project', 'plate.pdf'), 'fixture');
    const inventory = await objectInventory(root, objects);
    expect(inventory.map(({ path }) => path)).toEqual(['objects/project/plate.pdf']);
    expect(inventoryChecksum(inventory)).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      referencedObjectsMissing(['project/plate.pdf', 'project/missing.pdf'], inventory),
    ).toEqual(['project/missing.pdf']);
  });

  it('detects files added to an on-disk backup after its inventory was recorded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coda-recovery-test-'));
    const objects = join(root, 'objects');
    temporary.push(root);
    mkdirSync(objects, { recursive: true });
    writeFileSync(join(objects, 'signed.pdf'), 'signed');
    const signedInventory = await objectInventory(root, objects);

    writeFileSync(join(objects, 'unsigned.pdf'), 'unsigned');
    const actualInventory = await objectInventory(root, objects);

    expect(inventoryMismatches(signedInventory, actualInventory)).toEqual(['objects/unsigned.pdf']);
  });

  it('parses migration state strictly', () => {
    expect(parseMigrations('001_init\tabc\t2026-01-01T00:00:00Z\n')).toEqual([
      { name: '001_init', checksum: 'abc', finishedAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(() => parseMigrations('broken')).toThrow(/invalid/u);
  });

  it('authenticates manifest bytes with an external Ed25519 verification key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
    const publicPem = publicKey.export({ format: 'pem', type: 'spki' });
    const contents = Buffer.from('{"schemaVersion":1}\n');
    const signature = signRecoveryManifest(contents, privatePem);
    expect(verifyRecoveryManifestSignature(contents, signature, publicPem)).toBe(
      recoveryVerificationKeySha256(publicPem),
    );
    expect(recoverySigningKeyFingerprint(privatePem)).toBe(
      recoveryVerificationKeySha256(publicPem),
    );
    expect(() =>
      verifyRecoveryManifestSignature(Buffer.from('{"schemaVersion":2}\n'), signature, publicPem),
    ).toThrow(/invalid/u);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' });
    expect(() => verifyRecoveryManifestSignature(contents, signature, other)).toThrow(/invalid/u);
    expect(() => verifyRecoveryManifestSignature(contents, 'unsigned', publicPem)).toThrow(
      /malformed/u,
    );
  });

  it('rejects a manifest whose digest and reference differ', () => {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        composeProject: 'source',
        authenticity: {
          algorithm: 'Ed25519',
          verificationKeySha256: 'c'.repeat(64),
        },
        database: {},
        image: {
          digest: `sha256:${'b'.repeat(64)}`,
          reference: `ghcr.io/kinetik-gg/coda@${digest}`,
        },
        objectStorage: {},
      }),
    ).toThrow(/does not match/u);
  });

  it('rejects absolute and traversing manifest paths', () => {
    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      composeProject: 'source',
      authenticity: {
        algorithm: 'Ed25519',
        verificationKeySha256: 'c'.repeat(64),
      },
      database: { path: 'database.dump' },
      image: { digest, reference: `ghcr.io/kinetik-gg/coda@${digest}` },
      objectStorage: { files: [{ path: 'objects/../../outside' }] },
    };
    expect(() => validateManifest(manifest)).toThrow(/non-canonical/u);
    expect(() =>
      validateManifest({
        ...manifest,
        database: { path: '/tmp/database.dump' },
        objectStorage: { files: [] },
      }),
    ).toThrow(/canonical/u);
  });

  it('refuses to start an image that differs from the backup manifest', () => {
    const expected = `ghcr.io/kinetik-gg/coda@${digest}`;
    expect(() =>
      assertConfiguredImage({ services: { coda: { image: expected } } }, expected),
    ).not.toThrow();
    expect(() =>
      assertConfiguredImage(
        { services: { coda: { image: 'ghcr.io/kinetik-gg/coda:newer' } } },
        expected,
      ),
    ).toThrow(/does not match/u);
  });

  it('detects missing, corrupt, and unexpected live objects', () => {
    const expected = [{ path: 'objects/a', bytes: 4, sha256: 'aaaa' }];
    expect(inventoryMismatches(expected, expected)).toEqual([]);
    expect(
      inventoryMismatches(expected, [{ path: 'objects/a', bytes: 4, sha256: 'bbbb' }]),
    ).toEqual(['objects/a']);
    expect(
      inventoryMismatches(expected, [{ path: 'objects/b', bytes: 4, sha256: 'aaaa' }]),
    ).toEqual(['objects/a', 'objects/b']);
  });
});
