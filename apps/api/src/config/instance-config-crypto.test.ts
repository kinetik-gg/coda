import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConfigDecryptionError,
  decryptConfigValue,
  deriveConfigKey,
  encryptConfigValue,
} from './instance-config-crypto';

const material = randomBytes(32).toString('base64');
const otherMaterial = randomBytes(32).toString('base64');

describe('instance-config crypto', () => {
  it('round-trips plaintext through AES-256-GCM', () => {
    const key = deriveConfigKey(material);
    const { ciphertext, nonce } = encryptConfigValue(key, 'top-secret-value');
    expect(decryptConfigValue(key, ciphertext, nonce)).toBe('top-secret-value');
  });

  it('derives a stable 32-byte key from the same material', () => {
    const first = deriveConfigKey(material);
    const second = deriveConfigKey(material);
    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(true);
  });

  it('rejects key material shorter than 32 bytes', () => {
    expect(() => deriveConfigKey(randomBytes(16).toString('base64'))).toThrow(/at least 32 bytes/i);
  });

  it('produces a fresh nonce and distinct ciphertext per write', () => {
    const key = deriveConfigKey(material);
    const a = encryptConfigValue(key, 'value');
    const b = encryptConfigValue(key, 'value');
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('fails authentication when the ciphertext is tampered with', () => {
    const key = deriveConfigKey(material);
    const { ciphertext, nonce } = encryptConfigValue(key, 'value');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    expect(() => decryptConfigValue(key, ciphertext, nonce)).toThrow(ConfigDecryptionError);
  });

  it('fails authentication when the wrong key is used', () => {
    const { ciphertext, nonce } = encryptConfigValue(deriveConfigKey(material), 'value');
    expect(() => decryptConfigValue(deriveConfigKey(otherMaterial), ciphertext, nonce)).toThrow(
      ConfigDecryptionError,
    );
  });

  it('rejects a payload too short to contain an auth tag', () => {
    expect(() =>
      decryptConfigValue(deriveConfigKey(material), Buffer.alloc(4), Buffer.alloc(12)),
    ).toThrow(ConfigDecryptionError);
  });
});
