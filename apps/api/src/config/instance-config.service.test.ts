import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState: { CONFIG_ENCRYPTION_KEY?: string } = {
  CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

vi.mock('./env', () => ({ env: () => envState }));

import { ConfigEncryptionService } from './config-encryption.service';
import { InstanceConfigService } from './instance-config.service';

interface Row {
  key: string;
  schemaVersion: number;
  ciphertext: Buffer;
  nonce: Buffer;
  updatedAt: Date;
  updatedBy: string | null;
}

function fakePrisma(rows: Map<string, Row> = new Map()) {
  return {
    rows,
    instanceConfig: {
      findUnique: vi.fn(({ where: { key } }: { where: { key: string } }) =>
        Promise.resolve(rows.get(key) ?? null),
      ),
      findFirst: vi.fn(() => {
        const ordered = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
        return Promise.resolve(ordered[0] ?? null);
      }),
      count: vi.fn(({ where }: { where?: { key: string } } = {}) =>
        Promise.resolve(where?.key ? (rows.has(where.key) ? 1 : 0) : rows.size),
      ),
      upsert: vi.fn(
        ({
          where: { key },
          create,
          update,
        }: {
          where: { key: string };
          create: Omit<Row, 'updatedAt'>;
          update: Omit<Row, 'key' | 'updatedAt'>;
        }) => {
          const existing = rows.get(key);
          const next: Row = existing
            ? { ...existing, ...update, updatedAt: new Date() }
            : { ...create, updatedAt: new Date() };
          rows.set(key, next);
          return Promise.resolve(next);
        },
      ),
    },
  };
}

function makeService(prisma: ReturnType<typeof fakePrisma>) {
  return new InstanceConfigService(prisma as never, new ConfigEncryptionService());
}

/** Writes a raw encrypted row at an explicit schema version, bypassing setConfig. */
function seedRow(
  prisma: ReturnType<typeof fakePrisma>,
  key: string,
  version: number,
  value: unknown,
) {
  const encryption = new ConfigEncryptionService();
  const { ciphertext, nonce } = encryption.encrypt(JSON.stringify(value));
  prisma.rows.set(key, {
    key,
    schemaVersion: version,
    ciphertext,
    nonce,
    updatedAt: new Date(),
    updatedBy: null,
  });
}

describe('InstanceConfigService', () => {
  beforeEach(() => {
    envState.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('returns undefined for an unset key', async () => {
    const service = makeService(fakePrisma());
    expect(await service.getConfig('storage.settings')).toBeUndefined();
  });

  it('round-trips a validated value and stores only ciphertext', async () => {
    const prisma = fakePrisma();
    const service = makeService(prisma);
    await service.setConfig('backup.schedule', { cron: '0 3 * * *', retainDays: 30 }, 'user-1');

    const row = prisma.rows.get('backup.schedule')!;
    expect(row.schemaVersion).toBe(1);
    expect(row.updatedBy).toBe('user-1');
    expect(row.ciphertext.toString('utf8')).not.toContain('cron');

    expect(await service.getConfig('backup.schedule')).toEqual({
      cron: '0 3 * * *',
      retainDays: 30,
    });
  });

  it('rejects a value that violates the codec schema', async () => {
    const service = makeService(fakePrisma());
    await expect(
      service.setConfig('backup.schedule', { cron: '', retainDays: 0 } as never),
    ).rejects.toThrow();
  });

  it('migrates an older schema version and persists the upgraded blob', async () => {
    const prisma = fakePrisma();
    const service = makeService(prisma);
    seedRow(prisma, 'update.preferences', 1, { channel: 'beta' });

    const value = await service.getConfig('update.preferences');
    expect(value).toEqual({ channel: 'beta', autoApply: false });

    const row = prisma.rows.get('update.preferences')!;
    expect(row.schemaVersion).toBe(2);
    // Re-reading now takes the non-migration path and yields the same value.
    expect(await service.getConfig('update.preferences')).toEqual({
      channel: 'beta',
      autoApply: false,
    });
  });

  it('refuses to read a row written by a newer schema version', async () => {
    const prisma = fakePrisma();
    const service = makeService(prisma);
    seedRow(prisma, 'storage.settings', 99, { uploadRetentionHours: 24, pendingMaxObjects: 20 });
    await expect(service.getConfig('storage.settings')).rejects.toThrow(/newer application/i);
  });

  it('reports provenance for resolved values', async () => {
    const prisma = fakePrisma();
    const service = makeService(prisma);
    const envDefault = { uploadRetentionHours: 24, pendingMaxObjects: 20 };

    expect(await service.resolve('storage.settings', envDefault)).toEqual({
      value: envDefault,
      source: 'env',
    });

    await service.setConfig('storage.settings', {
      uploadRetentionHours: 48,
      pendingMaxObjects: 50,
    });
    expect(await service.resolve('storage.settings', envDefault)).toEqual({
      value: { uploadRetentionHours: 48, pendingMaxObjects: 50 },
      source: 'config',
    });
  });

  it('reports whether a key has a stored row', async () => {
    const prisma = fakePrisma();
    const service = makeService(prisma);
    expect(await service.hasConfig('backup.schedule')).toBe(false);
    await service.setConfig('backup.schedule', { cron: '0 0 * * *', retainDays: 7 });
    expect(await service.hasConfig('backup.schedule')).toBe(true);
  });

  describe('assertReadableAtBoot', () => {
    it('is a no-op when the store is empty', async () => {
      await expect(makeService(fakePrisma()).assertReadableAtBoot()).resolves.toBeUndefined();
    });

    it('fails closed when rows exist but the key is missing', async () => {
      const prisma = fakePrisma();
      await makeService(prisma).setConfig('backup.schedule', { cron: '0 0 * * *', retainDays: 7 });
      envState.CONFIG_ENCRYPTION_KEY = undefined;
      await expect(makeService(prisma).assertReadableAtBoot()).rejects.toThrow(
        /CONFIG_ENCRYPTION_KEY is not set/i,
      );
    });

    it('fails closed with a diagnostic when the key is wrong', async () => {
      const prisma = fakePrisma();
      await makeService(prisma).setConfig('backup.schedule', { cron: '0 0 * * *', retainDays: 7 });
      envState.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
      await expect(makeService(prisma).assertReadableAtBoot()).rejects.toThrow(
        /does not match the key/i,
      );
    });

    it('passes when the key decrypts an existing row', async () => {
      const prisma = fakePrisma();
      const service = makeService(prisma);
      await service.setConfig('backup.schedule', { cron: '0 0 * * *', retainDays: 7 });
      await expect(service.assertReadableAtBoot()).resolves.toBeUndefined();
    });
  });
});
