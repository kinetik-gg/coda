// THROWAWAY spike bootstrap: boot the REAL compiled NestJS AppModule against SQLite +
// the fs-backed fake-S3, skipping only the Postgres-shaped boot ceremony (tcp probe,
// `prisma migrate deploy`) that main.ts runs. Everything else is the production path.

// 1) Alias '@prisma/client' -> SQLite shim BEFORE anything requires it.
const Module = require('node:module');
const shim = require('./prisma-shim');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@prisma/client') return shim;
  return origLoad.call(this, request, parent, isMain);
};

const path = require('node:path');
const API = path.join(__dirname, '..', 'apps', 'api');
const DIST = path.join(API, 'dist');

// 2) Environment: production so the SPA is served and no dev redirect fires.
const dbPath = path.join(__dirname, 'spike.db');
Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: '3000',
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: `file:${dbPath}`,
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  S3_ENDPOINT: 'http://127.0.0.1:9010',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9010',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'coda-spike',
  S3_ACCESS_KEY: 'spike',
  S3_SECRET_KEY: 'spikesecret',
  S3_FORCE_PATH_STYLE: 'true',
  SETUP_TOKEN: 'spike-setup-token-0000000000000000',
  UPDATE_CHECK_INTERVAL_HOURS: '0',
  LOG_LEVEL: 'warn',
});

// App-level deps resolve from the API package (spike/ has no node_modules of its own).
const apiRequire = Module.createRequire(path.join(API, 'package.json'));
apiRequire('reflect-metadata');
const { NestFactory } = apiRequire('@nestjs/core');
const cookieParser = apiRequire('cookie-parser');
const { AppModule } = require(path.join(DIST, 'app.module.js'));
const { BigIntSerializerInterceptor } = require(path.join(DIST, 'common', 'bigint.interceptor.js'));
const { installBodyParsers } = require(path.join(DIST, 'common', 'body-parsers.js'));
const { env } = require(path.join(DIST, 'config', 'env.js'));
const { PrismaService } = require(path.join(DIST, 'prisma', 'prisma.service.js'));
const { findActiveSession } = require(path.join(DIST, 'auth', 'session-authentication.js'));
const { start: startFakeS3 } = require('./fake-s3');

async function main() {
  await startFakeS3(9010);
  const config = env();
  const app = await NestFactory.create(AppModule, { bufferLogs: false, bodyParser: false });
  const prisma = app.get(PrismaService);
  app.use(cookieParser());
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());
  installBodyParsers(app, {
    sessionCookieName: config.SESSION_COOKIE_NAME,
    maxBytes: config.SCREENPLAY_REQUEST_MAX_BYTES,
    maxConcurrent: config.SCREENPLAY_BODY_MAX_CONCURRENT,
    preAuthWindowMs: config.SCREENPLAY_PREAUTH_WINDOW_MS,
    preAuthMaxPerClient: config.SCREENPLAY_PREAUTH_MAX_PER_CLIENT,
    preAuthMaxGlobal: config.SCREENPLAY_PREAUTH_MAX_GLOBAL,
    timeoutMs: config.SCREENPLAY_BODY_TIMEOUT_MS,
    verifySession: (token) => findActiveSession(prisma, token),
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT, '127.0.0.1');
  console.log(`[spike] API up on http://localhost:${config.PORT} (sqlite ${dbPath})`);
}

main().catch((e) => {
  console.error('[spike] boot failed:', e);
  process.exit(1);
});
