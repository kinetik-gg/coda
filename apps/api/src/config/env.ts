import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_ORIGIN: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1),
    SESSION_COOKIE_NAME: z.string().default('coda_session'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SETUP_TOKEN: z.string().min(32).optional(),
    S3_ENDPOINT: z.string().url(),
    S3_PUBLIC_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(8),
    S3_FORCE_PATH_STYLE: booleanString.default(true),
    PDF_MAX_BYTES: z.coerce.number().int().positive().default(262_144_000),
    ASSET_MAX_BYTES: z.coerce.number().int().positive().default(2_147_483_648),
    SIGNED_READ_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    SIGNED_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.SETUP_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['SETUP_TOKEN'],
        message: 'SETUP_TOKEN is required in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
