import { createPrivateKey, createPublicKey, hkdfSync } from 'node:crypto';

/**
 * Deterministic Ed25519 backup key pair derived from the instance root secret.
 *
 * The in-app backup engine signs every archive and verifies every restore against an Ed25519 key
 * pair. Rather than introduce a separate operator-managed key file (as the offline recovery tooling
 * in `scripts/ops` uses), the in-app consumers derive the pair deterministically from
 * `CONFIG_ENCRYPTION_KEY` — the same durable instance secret that already encrypts the configuration
 * store and must be carried across a migration for the restored instance to function at all. This is
 * what makes the "download from instance A, restore into fresh instance B" circle work from the
 * interface alone: an operator who provisions B with A's `CONFIG_ENCRYPTION_KEY` (which they must, to
 * decrypt A's config rows) reproduces the exact verification key that authenticates A's archives, and
 * nobody else can.
 */
export interface BackupKeyPair {
  /** PKCS8 PEM Ed25519 private key used to sign archives. */
  signingKey: string;
  /** SPKI PEM Ed25519 public key used to verify archives. */
  verificationKey: string;
}

// The 16-byte PKCS8 DER prefix for an Ed25519 private key, followed by the 32-byte raw seed. Node's
// key parser accepts this structure directly, letting us build a deterministic key from a seed
// without a dedicated key-generation ceremony.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const HKDF_SALT = Buffer.from('coda-backup-signing-key/v1', 'utf8');
const HKDF_INFO = Buffer.from('ed25519-seed', 'utf8');

/** Raised when a backup operation needs the instance root secret but it is not configured. */
export class BackupKeyUnavailableError extends Error {
  constructor() {
    super(
      'CONFIG_ENCRYPTION_KEY must be set to a base64 key of at least 32 bytes before backups can be ' +
        'created or restored. It authenticates every archive and is required to restore one into a new instance.',
    );
    this.name = 'BackupKeyUnavailableError';
  }
}

/** Derive the deterministic Ed25519 backup key pair from a base64 instance secret. */
export function deriveBackupKeyPair(configEncryptionKey: string): BackupKeyPair {
  const secret = Buffer.from(configEncryptionKey, 'base64');
  if (secret.length < 32) throw new BackupKeyUnavailableError();
  const seed = Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32));
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  return {
    signingKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    verificationKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

/**
 * Resolve the backup key pair or throw {@link BackupKeyUnavailableError} when the instance root
 * secret is missing, so callers can surface a single actionable message.
 */
export function requireBackupKeyPair(configEncryptionKey: string | undefined): BackupKeyPair {
  if (!configEncryptionKey) throw new BackupKeyUnavailableError();
  return deriveBackupKeyPair(configEncryptionKey);
}
