import { describe, expect, it } from 'vitest';
import { CONFIG_CODECS, configCodec } from './instance-config-codecs';

describe('instance-config codecs', () => {
  it('exposes a codec for every registered key', () => {
    for (const key of Object.keys(CONFIG_CODECS) as (keyof typeof CONFIG_CODECS)[]) {
      const codec = configCodec(key);
      expect(codec.version).toBeGreaterThanOrEqual(1);
      expect(typeof codec.migrate).toBe('function');
    }
  });

  it('validates the current shape for each key', () => {
    expect(() =>
      configCodec('storage.settings').schema.parse({
        uploadRetentionHours: 24,
        pendingMaxObjects: 20,
      }),
    ).not.toThrow();
    expect(() =>
      configCodec('backup.schedule').schema.parse({
        enabled: true,
        intervalHours: 0,
        retention: { keepLast: 7, dailyForDays: 0, weeklyForWeeks: 0, maxAgeDays: 0 },
      }),
    ).toThrow();
    expect(() =>
      configCodec('backup.schedule').schema.parse({
        enabled: true,
        intervalHours: 24,
        retention: { keepLast: 0, dailyForDays: 0, weeklyForWeeks: 0, maxAgeDays: 0 },
      }),
    ).toThrow();
  });

  it('leaves version-1 payloads untouched for keys without a migration', () => {
    const value = { uploadRetentionHours: 24, pendingMaxObjects: 20 };
    expect(configCodec('storage.settings').migrate(value, 1)).toBe(value);
    const schedule = {
      enabled: true,
      intervalHours: 24,
      retention: { keepLast: 7, dailyForDays: 7, weeklyForWeeks: 4, maxAgeDays: 90 },
    };
    expect(configCodec('backup.schedule').migrate(schedule, 1)).toBe(schedule);
  });

  it('validates and passes through a storage connection payload', () => {
    const codec = configCodec('storage.connection');
    const connection = {
      provider: 'minio' as const,
      endpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:59000',
      region: 'us-east-1',
      bucket: 'coda-objects',
      accessKeyId: 'access',
      secretAccessKey: 'super-secret',
      forcePathStyle: true,
    };
    expect(() => codec.schema.parse(connection)).not.toThrow();
    expect(codec.migrate(connection, 1)).toBe(connection);
    expect(() => codec.schema.parse({ ...connection, provider: 'unknown' })).toThrow();
    expect(() => codec.schema.parse({ ...connection, bucket: 'ab' })).toThrow();
  });

  it('upgrades legacy update preferences and passes current ones through', () => {
    const codec = configCodec('update.preferences');
    expect(codec.migrate({ channel: 'stable' }, 1)).toEqual({
      channel: 'stable',
      autoApply: false,
    });
    const current = { channel: 'beta', autoApply: true };
    expect(codec.migrate(current, 2)).toBe(current);
  });
});
