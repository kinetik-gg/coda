import { describe, expect, it, vi } from 'vitest';
import { createPublicKey } from 'node:crypto';
import { ScheduledBackupSigningService } from './scheduled-backup-signing';

function fakeInstanceConfig() {
  const store = new Map<string, unknown>();
  return {
    store,
    getConfig: vi.fn((key: string) => Promise.resolve(store.get(key))),
    setConfig: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  };
}

describe('ScheduledBackupSigningService', () => {
  it('generates and persists an Ed25519 key pair on first use', async () => {
    const config = fakeInstanceConfig();
    const service = new ScheduledBackupSigningService(config as never);

    const material = await service.ensureKeyMaterial('owner-1');

    expect(material.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(material.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(material.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(createPublicKey(material.publicKeyPem).asymmetricKeyType).toBe('ed25519');
    expect(config.setConfig).toHaveBeenCalledWith(
      'backup.signingKey',
      { privateKeyPem: material.privateKeyPem, publicKeyPem: material.publicKeyPem },
      'owner-1',
    );
  });

  it('returns the stored key pair on subsequent calls without regenerating', async () => {
    const config = fakeInstanceConfig();
    const service = new ScheduledBackupSigningService(config as never);

    const first = await service.ensureKeyMaterial();
    config.setConfig.mockClear();
    const second = await service.ensureKeyMaterial();

    expect(second.privateKeyPem).toBe(first.privateKeyPem);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(config.setConfig).not.toHaveBeenCalled();
  });

  it('reports the fingerprint only once a key pair exists', async () => {
    const config = fakeInstanceConfig();
    const service = new ScheduledBackupSigningService(config as never);

    expect(await service.fingerprint()).toBeNull();
    const material = await service.ensureKeyMaterial();
    expect(await service.fingerprint()).toBe(material.fingerprint);
  });
});
