import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  KeyObject,
} from 'node:crypto';

/**
 * Ed25519 manifest signing shared with the operator recovery tooling in
 * `scripts/ops/recovery-core.ts`. The application backup engine reuses the exact
 * signature encoding (raw Ed25519 over the canonical manifest bytes, base64 with a
 * trailing newline) and the SPKI-DER SHA-256 verification-key fingerprint so that a
 * single Ed25519 key pair authenticates both operator and in-app archives.
 */
export const BACKUP_SIGNATURE_ALGORITHM = 'Ed25519';

function ed25519PrivateKey(value: string | Buffer): KeyObject {
  const key = createPrivateKey(value);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Backup signing key must be an Ed25519 private key');
  }
  return key;
}

function ed25519PublicKey(value: string | Buffer): KeyObject {
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Backup verification key must be an Ed25519 public key');
  }
  return key;
}

export function backupVerificationKeySha256(key: string | Buffer | KeyObject): string {
  const publicKey =
    key instanceof KeyObject
      ? key.type === 'public'
        ? key
        : createPublicKey(key)
      : ed25519PublicKey(key);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Backup verification key must be an Ed25519 public key');
  }
  return createHash('sha256')
    .update(publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex');
}

export function backupSigningKeyFingerprint(key: string | Buffer): string {
  return backupVerificationKeySha256(ed25519PrivateKey(key));
}

export function signBackupManifest(contents: Buffer, privateKey: string | Buffer): string {
  return `${sign(null, contents, ed25519PrivateKey(privateKey)).toString('base64')}\n`;
}

/**
 * Verifies a manifest signature and returns the verifying key fingerprint. The
 * signature string is a base64-encoded 64-byte Ed25519 signature with an optional
 * trailing newline. Throws before any archive payload is trusted when the signature
 * is malformed, tampered, or produced by a different key.
 */
export function verifyBackupManifestSignature(
  contents: Buffer,
  signatureText: string,
  publicKey: string | Buffer,
): string {
  if (!/^[A-Za-z0-9+/]{86}==\r?\n?$/u.test(signatureText)) {
    throw new Error('Backup manifest signature is malformed');
  }
  const key = ed25519PublicKey(publicKey);
  const signature = Buffer.from(signatureText.trim(), 'base64');
  if (!verify(null, contents, key, signature)) {
    throw new Error('Backup manifest signature is invalid');
  }
  return backupVerificationKeySha256(key);
}
