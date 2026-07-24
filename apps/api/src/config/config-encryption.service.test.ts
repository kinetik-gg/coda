import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState: { CONFIG_ENCRYPTION_KEY?: string } = {
  CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

vi.mock('./env', () => ({ env: () => envState }));

import { ConfigEncryptionService } from './config-encryption.service';

describe('ConfigEncryptionService', () => {
  beforeEach(() => {
    envState.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('reports configured when key material is present', () => {
    expect(new ConfigEncryptionService().configured).toBe(true);
  });

  it('reports not configured when key material is absent', () => {
    envState.CONFIG_ENCRYPTION_KEY = undefined;
    expect(new ConfigEncryptionService().configured).toBe(false);
  });

  it('round-trips a value with the derived key', () => {
    const service = new ConfigEncryptionService();
    const { ciphertext, nonce } = service.encrypt('secret');
    expect(service.decrypt(ciphertext, nonce)).toBe('secret');
  });

  it('fails closed when encrypting without a configured key', () => {
    envState.CONFIG_ENCRYPTION_KEY = undefined;
    expect(() => new ConfigEncryptionService().encrypt('secret')).toThrow(
      /CONFIG_ENCRYPTION_KEY is not set/i,
    );
  });

  it('fails closed when decrypting without a configured key', () => {
    envState.CONFIG_ENCRYPTION_KEY = undefined;
    expect(() => new ConfigEncryptionService().decrypt(Buffer.alloc(20), Buffer.alloc(12))).toThrow(
      /CONFIG_ENCRYPTION_KEY is not set/i,
    );
  });
});
