import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  APP_ORIGIN: 'https://app.example.test',
  S3_ENDPOINT: 'http://storage:9000',
  S3_PUBLIC_ENDPOINT: 'https://objects.example.test',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY: 'test-access',
  S3_SECRET_KEY: 'test-secret',
};

describe('environment validation', () => {
  it('accepts a dedicated public object-storage origin', () => {
    const parsed = parseEnv(base);
    expect(parsed.S3_PUBLIC_ENDPOINT).toBe('https://objects.example.test');
    expect(parsed.PDF_WORKER_MAX_OLD_GENERATION_MB).toBe(512);
    expect(parsed.STORAGE_PENDING_MAX_OBJECTS).toBe(20);
    expect(parsed.STORAGE_PENDING_MAX_BYTES).toBe(5_368_709_120);
    expect(parsed.STORAGE_PENDING_INSTANCE_MAX_OBJECTS).toBe(1_000);
    expect(parsed.STORAGE_PENDING_INSTANCE_MAX_BYTES).toBe(21_474_836_480);
    expect(parsed.STORAGE_UPLOAD_RETENTION_HOURS).toBe(24);
  });

  it('rejects object storage on the application origin', () => {
    expect(() =>
      parseEnv({ ...base, S3_PUBLIC_ENDPOINT: 'https://app.example.test/objects' }),
    ).toThrow(/different origin/i);
  });

  it('requires a setup token in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SETUP_TOKEN/);
  });

  it('rejects PDF and upload-cleanup limits outside their safe ranges', () => {
    expect(() => parseEnv({ ...base, PDF_MAX_BYTES: '262144001' })).toThrow();
    expect(() => parseEnv({ ...base, PDF_WORKER_MAX_OLD_GENERATION_MB: '32' })).toThrow();
    expect(() => parseEnv({ ...base, STORAGE_PENDING_MAX_OBJECTS: '0' })).toThrow();
    expect(() => parseEnv({ ...base, STORAGE_PENDING_INSTANCE_MAX_OBJECTS: '10001' })).toThrow();
    expect(() => parseEnv({ ...base, STORAGE_UPLOAD_RETENTION_HOURS: '721' })).toThrow();
  });

  it('parses explicit trusted proxy IPs and CIDRs', () => {
    expect(
      parseEnv({ ...base, TRUSTED_PROXY_CIDRS: '127.0.0.1/32, 10.20.30.0/24,::1' })
        .TRUSTED_PROXY_CIDRS,
    ).toEqual(['127.0.0.1/32', '10.20.30.0/24', '::1']);
  });

  it.each(['0.0.0.0/0', '::/0', 'proxy.internal', '10.0.0.0/33', '127.0.0.1/32/1'])(
    'rejects unsafe or malformed trusted proxy entry %s',
    (entry) => {
      expect(() => parseEnv({ ...base, TRUSTED_PROXY_CIDRS: entry })).toThrow(
        /IP address or non-zero CIDR/i,
      );
    },
  );
});
