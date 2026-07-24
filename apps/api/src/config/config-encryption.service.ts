import { Injectable } from '@nestjs/common';
import { env } from './env';
import {
  decryptConfigValue,
  deriveConfigKey,
  encryptConfigValue,
  type EncryptedPayload,
} from './instance-config-crypto';

/**
 * Owns the AES-256 key derived from `CONFIG_ENCRYPTION_KEY` and exposes
 * encrypt/decrypt to the configuration service. The key is derived lazily and
 * cached; when no key is configured, {@link configured} is false and any
 * encrypt/decrypt attempt fails closed with an actionable error.
 */
@Injectable()
export class ConfigEncryptionService {
  private cachedKey: Buffer | null = null;

  /** Whether operator key material is present in the environment. */
  get configured(): boolean {
    return Boolean(env().CONFIG_ENCRYPTION_KEY);
  }

  private key(): Buffer {
    const material = env().CONFIG_ENCRYPTION_KEY;
    if (!material) {
      throw new Error(
        'CONFIG_ENCRYPTION_KEY is not set. Provide a 32+ byte base64 key to read or write encrypted instance configuration.',
      );
    }
    this.cachedKey ??= deriveConfigKey(material);
    return this.cachedKey;
  }

  encrypt(plaintext: string): EncryptedPayload {
    return encryptConfigValue(this.key(), plaintext);
  }

  decrypt(ciphertext: Buffer, nonce: Buffer): string {
    return decryptConfigValue(this.key(), ciphertext, nonce);
  }
}
