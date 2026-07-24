import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  backupSigningKeyFingerprint,
  backupVerificationKeySha256,
  signBackupManifest,
  verifyBackupManifestSignature,
} from './backup-signing';

function keyPair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

describe('backup manifest signing', () => {
  it('signs and verifies manifest bytes with a matching fingerprint', () => {
    const { privatePem, publicPem } = keyPair();
    const contents = Buffer.from('{"formatVersion":1}\n');
    const signature = signBackupManifest(contents, privatePem);
    expect(verifyBackupManifestSignature(contents, signature, publicPem)).toBe(
      backupVerificationKeySha256(publicPem),
    );
    expect(backupSigningKeyFingerprint(privatePem)).toBe(backupVerificationKeySha256(publicPem));
  });

  it('rejects tampered content, wrong keys, and malformed signatures', () => {
    const { privatePem, publicPem } = keyPair();
    const contents = Buffer.from('{"formatVersion":1}\n');
    const signature = signBackupManifest(contents, privatePem);
    expect(() =>
      verifyBackupManifestSignature(Buffer.from('{"formatVersion":2}\n'), signature, publicPem),
    ).toThrow(/invalid/u);
    const other = keyPair().publicPem;
    expect(() => verifyBackupManifestSignature(contents, signature, other)).toThrow(/invalid/u);
    expect(() => verifyBackupManifestSignature(contents, 'not-base64', publicPem)).toThrow(
      /malformed/u,
    );
  });

  it('rejects non-Ed25519 keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privatePem = rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(() => backupSigningKeyFingerprint(privatePem)).toThrow(/Ed25519 private key/u);
    const publicPem = rsa.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(() => backupVerificationKeySha256(publicPem)).toThrow(/Ed25519 public key/u);
  });
});
