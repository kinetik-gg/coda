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
    expect(parsed.SCREENPLAY_REQUEST_MAX_BYTES).toBe(20_016_384);
    expect(parsed.SCREENPLAY_BODY_MAX_CONCURRENT).toBe(4);
    expect(parsed.SCREENPLAY_PREAUTH_WINDOW_MS).toBe(60_000);
    expect(parsed.SCREENPLAY_PREAUTH_MAX_PER_CLIENT).toBe(120);
    expect(parsed.SCREENPLAY_PREAUTH_MAX_GLOBAL).toBe(1_200);
    expect(parsed.SCREENPLAY_BODY_TIMEOUT_MS).toBe(30_000);
    expect(parsed.SCREENPLAY_MAX_DOCUMENTS_PER_OWNER).toBe(250);
    expect(parsed.SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER).toBe(262_144_000);
    expect(parsed.STORAGE_PENDING_MAX_OBJECTS).toBe(20);
    expect(parsed.STORAGE_PENDING_MAX_BYTES).toBe(5_368_709_120);
    expect(parsed.STORAGE_PENDING_INSTANCE_MAX_OBJECTS).toBe(1_000);
    expect(parsed.STORAGE_PENDING_INSTANCE_MAX_BYTES).toBe(21_474_836_480);
    expect(parsed.STORAGE_UPLOAD_RETENTION_HOURS).toBe(24);
    expect(parsed.DEV_ALLOWED_ORIGINS).toEqual([]);
    expect(parsed.AUTH_LOGIN_BACKOFF_THRESHOLD).toBe(5);
    expect(parsed.AUTH_LOGIN_BACKOFF_WINDOWS_MS).toEqual([60_000, 300_000, 900_000]);
  });

  it('parses a custom login backoff threshold and windows', () => {
    const parsed = parseEnv({
      ...base,
      AUTH_LOGIN_BACKOFF_THRESHOLD: '3',
      AUTH_LOGIN_BACKOFF_WINDOWS_MS: '1000, 2000 ,4000',
    });
    expect(parsed.AUTH_LOGIN_BACKOFF_THRESHOLD).toBe(3);
    expect(parsed.AUTH_LOGIN_BACKOFF_WINDOWS_MS).toEqual([1_000, 2_000, 4_000]);
  });

  it('rejects a login backoff window below the minimum delay', () => {
    expect(() => parseEnv({ ...base, AUTH_LOGIN_BACKOFF_WINDOWS_MS: '500' })).toThrow();
  });

  it('parses explicit development browser origins', () => {
    expect(
      parseEnv({
        ...base,
        DEV_ALLOWED_ORIGINS: 'http://192.168.1.10:5173, http://10.0.0.5:5173',
      }).DEV_ALLOWED_ORIGINS,
    ).toEqual(['http://192.168.1.10:5173', 'http://10.0.0.5:5173']);
  });

  it('rejects development origins with paths or in production', () => {
    expect(() => parseEnv({ ...base, DEV_ALLOWED_ORIGINS: 'http://localhost:5173/path' })).toThrow(
      /origin without a path/i,
    );
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        SETUP_TOKEN: 'a'.repeat(32),
        DEV_ALLOWED_ORIGINS: 'https://dev.example.test',
      }),
    ).toThrow(/only outside production/i);
  });

  it('rejects object storage on the application origin', () => {
    expect(() => parseEnv({ ...base, S3_PUBLIC_ENDPOINT: 'https://app.example.test' })).toThrow(
      /different origin/i,
    );
  });

  it('leaves METRICS_TOKEN undefined when unset or blank', () => {
    expect(parseEnv(base).METRICS_TOKEN).toBeUndefined();
    expect(parseEnv({ ...base, METRICS_TOKEN: '' }).METRICS_TOKEN).toBeUndefined();
  });

  it('accepts an explicit METRICS_TOKEN at or above the minimum length', () => {
    expect(parseEnv({ ...base, METRICS_TOKEN: 'a'.repeat(16) }).METRICS_TOKEN).toBe('a'.repeat(16));
  });

  it('rejects a METRICS_TOKEN below the minimum length', () => {
    expect(() => parseEnv({ ...base, METRICS_TOKEN: 'short' })).toThrow();
  });

  it('requires origin-only application and public object URLs', () => {
    expect(() => parseEnv({ ...base, APP_ORIGIN: 'https://app.example.test/path' })).toThrow(
      /origin without a path/i,
    );
    expect(() =>
      parseEnv({ ...base, S3_PUBLIC_ENDPOINT: 'https://objects.example.test/path' }),
    ).toThrow(/origin without a path/i);
  });

  it('requires HTTPS for non-loopback production origins', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      SETUP_TOKEN: 'a'.repeat(32),
    };
    expect(() => parseEnv({ ...production, APP_ORIGIN: 'http://10.20.30.40:3000' })).toThrow(
      /APP_ORIGIN must use HTTPS/i,
    );
    expect(() =>
      parseEnv({
        ...production,
        S3_PUBLIC_ENDPOINT: 'http://objects.example.test:9000',
      }),
    ).toThrow(/S3_PUBLIC_ENDPOINT must use HTTPS/i);
  });

  it('allows explicit loopback-local HTTP origins in production', () => {
    expect(
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        SETUP_TOKEN: 'a'.repeat(32),
        APP_ORIGIN: 'http://coda.localhost:3000',
        S3_PUBLIC_ENDPOINT: 'http://objects.localhost:9000',
      }),
    ).toMatchObject({
      APP_ORIGIN: 'http://coda.localhost:3000',
      S3_PUBLIC_ENDPOINT: 'http://objects.localhost:9000',
    });
  });

  it('allows production without a setup token so it can be auto-generated at boot', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'production' }).SETUP_TOKEN).toBeUndefined();
  });

  it('treats a blank setup token as unset', () => {
    expect(parseEnv({ ...base, SETUP_TOKEN: '' }).SETUP_TOKEN).toBeUndefined();
    expect(parseEnv({ ...base, SETUP_TOKEN: '   ' }).SETUP_TOKEN).toBeUndefined();
    expect(
      parseEnv({ ...base, NODE_ENV: 'production', SETUP_TOKEN: '' }).SETUP_TOKEN,
    ).toBeUndefined();
  });

  it('keeps validating an explicit setup token length', () => {
    expect(() => parseEnv({ ...base, SETUP_TOKEN: 'too-short' })).toThrow();
    expect(parseEnv({ ...base, SETUP_TOKEN: 'a'.repeat(32) }).SETUP_TOKEN).toBe('a'.repeat(32));
  });

  it('rejects PDF and upload-cleanup limits outside their safe ranges', () => {
    expect(() => parseEnv({ ...base, PDF_MAX_BYTES: '262144001' })).toThrow();
    expect(() => parseEnv({ ...base, PDF_WORKER_MAX_OLD_GENERATION_MB: '32' })).toThrow();
    expect(() => parseEnv({ ...base, STORAGE_PENDING_MAX_OBJECTS: '0' })).toThrow();
    expect(() => parseEnv({ ...base, STORAGE_PENDING_INSTANCE_MAX_OBJECTS: '10001' })).toThrow();
    expect(() => parseEnv({ ...base, STORAGE_UPLOAD_RETENTION_HOURS: '721' })).toThrow();
  });

  it('reserves screenplay body capacity for a second session', () => {
    expect(() => parseEnv({ ...base, SCREENPLAY_BODY_MAX_CONCURRENT: '1' })).toThrow();
    expect(parseEnv({ ...base, SCREENPLAY_BODY_MAX_CONCURRENT: '2' })).toMatchObject({
      SCREENPLAY_BODY_MAX_CONCURRENT: 2,
    });
  });

  it('requires the global screenplay pre-auth limit to cover each client', () => {
    expect(() =>
      parseEnv({
        ...base,
        SCREENPLAY_PREAUTH_MAX_PER_CLIENT: '10',
        SCREENPLAY_PREAUTH_MAX_GLOBAL: '9',
      }),
    ).toThrow(/global screenplay pre-auth limit/i);
  });

  it('defaults HTTP error detail logging to disabled and parses the opt-in flag', () => {
    expect(parseEnv(base).LOG_HTTP_ERROR_DETAIL).toBe(false);
    expect(parseEnv({ ...base, LOG_HTTP_ERROR_DETAIL: 'true' }).LOG_HTTP_ERROR_DETAIL).toBe(true);
    expect(parseEnv({ ...base, LOG_HTTP_ERROR_DETAIL: 'false' }).LOG_HTTP_ERROR_DETAIL).toBe(false);
    expect(() => parseEnv({ ...base, LOG_HTTP_ERROR_DETAIL: 'yes' })).toThrow();
  });

  it('leaves the config encryption key unset when absent or blank', () => {
    expect(parseEnv(base).CONFIG_ENCRYPTION_KEY).toBeUndefined();
    expect(
      parseEnv({ ...base, CONFIG_ENCRYPTION_KEY: '   ' }).CONFIG_ENCRYPTION_KEY,
    ).toBeUndefined();
  });

  it('accepts a 32+ byte base64 config encryption key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(parseEnv({ ...base, CONFIG_ENCRYPTION_KEY: key }).CONFIG_ENCRYPTION_KEY).toBe(key);
  });

  it('rejects a config encryption key shorter than 32 bytes', () => {
    expect(() =>
      parseEnv({ ...base, CONFIG_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') }),
    ).toThrow(/at least 32 bytes/i);
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

  it('defaults the release-checker poll interval to 24 hours', () => {
    expect(parseEnv(base).UPDATE_CHECK_INTERVAL_HOURS).toBe(24);
  });

  it('parses 0 as an explicit opt-out that disables polling', () => {
    expect(
      parseEnv({ ...base, UPDATE_CHECK_INTERVAL_HOURS: '0' }).UPDATE_CHECK_INTERVAL_HOURS,
    ).toBe(0);
  });

  it('parses a custom positive release-checker poll interval', () => {
    expect(
      parseEnv({ ...base, UPDATE_CHECK_INTERVAL_HOURS: '6' }).UPDATE_CHECK_INTERVAL_HOURS,
    ).toBe(6);
  });

  it('rejects a negative, fractional, or out-of-range release-checker poll interval', () => {
    expect(() => parseEnv({ ...base, UPDATE_CHECK_INTERVAL_HOURS: '-1' })).toThrow();
    expect(() => parseEnv({ ...base, UPDATE_CHECK_INTERVAL_HOURS: '1.5' })).toThrow();
    expect(() => parseEnv({ ...base, UPDATE_CHECK_INTERVAL_HOURS: '8761' })).toThrow();
  });

  it('accepts the "auto" trusted-proxy sentinel', () => {
    expect(parseEnv({ ...base, TRUSTED_PROXY_CIDRS: 'auto' }).TRUSTED_PROXY_CIDRS).toBe('auto');
    expect(parseEnv({ ...base, TRUSTED_PROXY_CIDRS: ' AUTO ' }).TRUSTED_PROXY_CIDRS).toBe('auto');
  });

  it('rejects mixing "auto" with explicit trusted-proxy CIDRs', () => {
    expect(() => parseEnv({ ...base, TRUSTED_PROXY_CIDRS: 'auto, 10.20.30.0/24' })).toThrow(
      /auto.*on its own|not both/i,
    );
  });

  it('rejects an empty trusted-proxy list', () => {
    expect(() => parseEnv({ ...base, TRUSTED_PROXY_CIDRS: ' , ' })).toThrow(
      /at least one trusted proxy/i,
    );
  });

  it('rejects more than 32 trusted-proxy CIDRs', () => {
    const many = Array.from({ length: 33 }, (_, index) => `10.0.${index}.0/24`).join(',');
    expect(() => parseEnv({ ...base, TRUSTED_PROXY_CIDRS: many })).toThrow(/at most 32/i);
  });
});
