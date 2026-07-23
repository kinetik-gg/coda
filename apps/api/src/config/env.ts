import { z } from 'zod';
import { isIP } from 'node:net';
import { MAX_SIGNED_UPLOAD_TTL_SECONDS } from './security-limits';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const originSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === value, 'Expected an origin without a path');

function isLoopbackHttpOrigin(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== 'http:') return false;
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (isIP(hostname) === 4) return hostname.startsWith('127.');
  return hostname === '::1';
}

const devAllowedOrigins = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(originSchema).max(16));

function validProxyCidr(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  const family = address ? isIP(address) : 0;
  if (!family || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/u.test(prefix)) return false;
  const bits = Number(prefix);
  return bits > 0 && bits <= (family === 4 ? 32 : 128);
}

const trustedProxyCidrs = z
  .string()
  .default('127.0.0.1/32,::1/128')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().refine(validProxyCidr, 'Expected an IP address or non-zero CIDR'))
      .min(1)
      .max(32),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_ORIGIN: originSchema.default('http://localhost:3000'),
    DEV_ALLOWED_ORIGINS: devAllowedOrigins,
    TRUSTED_PROXY_CIDRS: trustedProxyCidrs,
    DATABASE_URL: z.string().min(1),
    SESSION_COOKIE_NAME: z.string().default('coda_session'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SETUP_TOKEN: z.string().min(32).optional(),
    S3_ENDPOINT: z.string().url(),
    S3_PUBLIC_ENDPOINT: originSchema,
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(8),
    S3_FORCE_PATH_STYLE: booleanString.default(true),
    PDF_MAX_BYTES: z.coerce.number().int().positive().max(262_144_000).default(262_144_000),
    PDF_WORKER_MAX_OLD_GENERATION_MB: z.coerce.number().int().min(64).max(1024).default(512),
    SCREENPLAY_REQUEST_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1_048_576)
      .max(25_000_000)
      .default(20_016_384),
    SCREENPLAY_BODY_MAX_CONCURRENT: z.coerce.number().int().min(2).max(64).default(4),
    SCREENPLAY_PREAUTH_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    SCREENPLAY_PREAUTH_MAX_PER_CLIENT: z.coerce.number().int().min(1).max(10_000).default(120),
    SCREENPLAY_PREAUTH_MAX_GLOBAL: z.coerce.number().int().min(1).max(100_000).default(1_200),
    SCREENPLAY_BODY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    SCREENPLAY_MAX_DOCUMENTS_PER_OWNER: z.coerce.number().int().min(1).max(10_000).default(250),
    SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER: z.coerce
      .number()
      .int()
      .min(1_048_576)
      .max(Number.MAX_SAFE_INTEGER)
      .default(262_144_000),
    ASSET_MAX_BYTES: z.coerce.number().int().positive().default(2_147_483_648),
    STORAGE_PENDING_MAX_OBJECTS: z.coerce.number().int().min(1).max(1_000).default(20),
    STORAGE_PENDING_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(5_368_709_120),
    STORAGE_PENDING_INSTANCE_MAX_OBJECTS: z.coerce.number().int().min(1).max(10_000).default(1_000),
    STORAGE_PENDING_INSTANCE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(21_474_836_480),
    STORAGE_UPLOAD_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(24),
    SIGNED_READ_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    SIGNED_UPLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(MAX_SIGNED_UPLOAD_TTL_SECONDS)
      .default(900),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_HTTP_ERROR_DETAIL: booleanString.default(false),
  })
  .superRefine((value, context) => {
    if (value.SCREENPLAY_PREAUTH_MAX_GLOBAL < value.SCREENPLAY_PREAUTH_MAX_PER_CLIENT) {
      context.addIssue({
        code: 'custom',
        path: ['SCREENPLAY_PREAUTH_MAX_GLOBAL'],
        message: 'Global screenplay pre-auth limit must cover the per-client limit',
      });
    }
    if (value.NODE_ENV === 'production' && !value.SETUP_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['SETUP_TOKEN'],
        message: 'SETUP_TOKEN is required in production',
      });
    }
    if (value.NODE_ENV === 'production' && value.DEV_ALLOWED_ORIGINS.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['DEV_ALLOWED_ORIGINS'],
        message: 'DEV_ALLOWED_ORIGINS is available only outside production',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      new URL(value.APP_ORIGIN).protocol !== 'https:' &&
      !isLoopbackHttpOrigin(value.APP_ORIGIN)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN must use HTTPS in production unless it is loopback-local',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      new URL(value.S3_PUBLIC_ENDPOINT).protocol !== 'https:' &&
      !isLoopbackHttpOrigin(value.S3_PUBLIC_ENDPOINT)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['S3_PUBLIC_ENDPOINT'],
        message: 'S3_PUBLIC_ENDPOINT must use HTTPS in production unless it is loopback-local',
      });
    }
    if (new URL(value.APP_ORIGIN).origin === new URL(value.S3_PUBLIC_ENDPOINT).origin) {
      context.addIssue({
        code: 'custom',
        path: ['S3_PUBLIC_ENDPOINT'],
        message: 'S3_PUBLIC_ENDPOINT must use a different origin from APP_ORIGIN',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  return envSchema.parse(source);
}

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
