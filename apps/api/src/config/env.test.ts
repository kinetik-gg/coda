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
    expect(parseEnv(base).S3_PUBLIC_ENDPOINT).toBe('https://objects.example.test');
  });

  it('rejects object storage on the application origin', () => {
    expect(() =>
      parseEnv({ ...base, S3_PUBLIC_ENDPOINT: 'https://app.example.test/objects' }),
    ).toThrow(/different origin/i);
  });

  it('requires a setup token in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SETUP_TOKEN/);
  });
});
