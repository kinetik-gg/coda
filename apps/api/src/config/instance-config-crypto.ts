import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption primitives for the instance-configuration store.
 *
 * Every value at rest is ciphertext plus a per-write random nonce and a
 * Galois/Counter-Mode authentication tag. The tag is appended to the ciphertext
 * so that any bit flip in the stored blob, or an attempt to decrypt with the
 * wrong key, fails the authentication check instead of returning corrupt data.
 */

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const AES_256_KEY_BYTES = 32;

/** Raised when authenticated decryption fails (tampering or a wrong key). */
export class ConfigDecryptionError extends Error {
  constructor(message = 'Instance configuration could not be decrypted') {
    super(message);
    this.name = 'ConfigDecryptionError';
  }
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
}

/**
 * Derives the fixed-length AES-256 key from operator-supplied key material.
 *
 * The material is base64-decoded and folded through SHA-256 so any input of at
 * least 32 raw bytes yields a stable 32-byte key. The derivation is
 * deterministic: the same material always produces the same key, so a container
 * recreated with the same `CONFIG_ENCRYPTION_KEY` reads existing rows unchanged.
 */
export function deriveConfigKey(material: string): Buffer {
  const raw = Buffer.from(material, 'base64');
  if (raw.length < AES_256_KEY_BYTES) {
    throw new Error('CONFIG_ENCRYPTION_KEY must decode to at least 32 bytes');
  }
  return createHash('sha256').update(raw).digest();
}

/** Encrypts UTF-8 plaintext, returning ciphertext (with appended tag) and nonce. */
export function encryptConfigValue(key: Buffer, plaintext: string): EncryptedPayload {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([encrypted, authTag]), nonce };
}

/**
 * Decrypts a payload, verifying the authentication tag. Throws
 * {@link ConfigDecryptionError} when the tag does not verify — the signal for a
 * tampered blob or the wrong encryption key.
 */
export function decryptConfigValue(key: Buffer, ciphertext: Buffer, nonce: Buffer): string {
  if (ciphertext.length < AUTH_TAG_BYTES) {
    throw new ConfigDecryptionError();
  }
  const tagOffset = ciphertext.length - AUTH_TAG_BYTES;
  const encrypted = ciphertext.subarray(0, tagOffset);
  const authTag = ciphertext.subarray(tagOffset);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new ConfigDecryptionError();
  }
}
