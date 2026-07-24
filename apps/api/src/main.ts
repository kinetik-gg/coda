import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { type Request, type Response, type NextFunction } from 'express';
import { AppModule } from './app.module';
import { BigIntSerializerInterceptor } from './common/bigint.interceptor';
import { installBodyParsers } from './common/body-parsers';
import { createRequestErrorSerializer } from './common/http-error-serializer';
import { sanitizeRequestTarget } from './common/request-target';
import { isBrowserOriginAllowed, requiresAllowedBrowserOrigin } from './config/browser-origin';
import { env } from './config/env';
import {
  AUTO_TRUSTED_PROXIES,
  configureTrustedProxies,
  resolveTrustedProxyCidrs,
} from './config/trusted-proxies';
import { PrismaService } from './prisma/prisma.service';
import { InstanceConfigService } from './config/instance-config.service';
import { SetupTokenService } from './auth/setup-token.service';
import { findActiveSession } from './auth/session-authentication';
import { ensureDatabaseReady } from './boot/database-readiness';
import { createProductionDatabaseReadinessDeps } from './boot/database-readiness.runtime';
import { createHttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { createMetricsRoute, registerMetricsRoute } from './metrics/metrics.route';
import { MetricsService } from './metrics/metrics.service';

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestId(request: Request): string {
  const candidate = request.headers['x-request-id'];
  return typeof candidate === 'string' && requestIdPattern.test(candidate)
    ? candidate
    : randomUUID();
}

async function bootstrap(): Promise<void> {
  const config = env();
  await ensureDatabaseReady(
    {
      databaseUrl: config.DATABASE_URL,
      port: config.PORT,
      retryWindowsMs: config.DB_BOOT_RETRY_WINDOWS_MS,
    },
    createProductionDatabaseReadinessDeps(config, path.join(__dirname, '..')),
  );
  const secureOrigin = new URL(config.APP_ORIGIN).protocol === 'https:';
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const trustedProxyCidrs = resolveTrustedProxyCidrs(config.TRUSTED_PROXY_CIDRS);
  configureTrustedProxies(app, trustedProxyCidrs);
  const trustSource =
    config.TRUSTED_PROXY_CIDRS === AUTO_TRUSTED_PROXIES
      ? 'auto-detected from container interfaces'
      : 'explicit configuration';
  new Logger('TrustedProxies').log(
    `Trusting X-Forwarded-For from ${trustedProxyCidrs.length} CIDR(s) (${trustSource}): ${
      trustedProxyCidrs.join(', ') || '(none)'
    }`,
  );
  const prisma = app.get(PrismaService);
  await app.get(InstanceConfigService).assertReadableAtBoot();
  if (config.NODE_ENV !== 'production') {
    app.use((request: Request, response: Response, next: NextFunction) => {
      const requestPath = request.originalUrl ?? request.url;
      if (!requestPath.startsWith('/api')) {
        return response.redirect(307, new URL(requestPath, config.APP_ORIGIN).toString());
      }
      next();
    });
  }
  app.use(cookieParser());
  app.use(
    helmet({
      strictTransportSecurity: secureOrigin,
      referrerPolicy: { policy: 'no-referrer' },
      contentSecurityPolicy: {
        directives: {
          connectSrc: ["'self'", new URL(config.S3_PUBLIC_ENDPOINT).origin],
          upgradeInsecureRequests: secureOrigin ? [] : null,
        },
      },
    }),
  );
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());
  // Registered directly on the underlying HTTP adapter, ahead of Nest's controller
  // routing and the ServeStaticModule SPA fallback: `/metrics` therefore bypasses both
  // and is never discoverable through Swagger/OpenAPI generation. Observation-only
  // (see createHttpMetricsMiddleware), so it adds no measurable request latency.
  const metrics = app.get(MetricsService);
  app.use(createHttpMetricsMiddleware(metrics.httpRequestDuration));
  registerMetricsRoute(app, createMetricsRoute(metrics, config.METRICS_TOKEN));
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      genReqId: requestId,
      wrapSerializers: false,
      serializers: {
        req: (request: Request & { id?: string | number }) => ({
          id: request.id,
          method: request.method,
          path: sanitizeRequestTarget(request.originalUrl ?? request.url),
        }),
        res: (response: Response) => ({ statusCode: response.statusCode }),
        err: createRequestErrorSerializer(config.LOG_HTTP_ERROR_DETAIL),
      },
    }),
  );
  app.use((request: Request, response: Response, next: NextFunction) => {
    request.requestId = typeof request.id === 'string' ? request.id : randomUUID();
    response.setHeader('x-request-id', request.requestId);
    const origin = request.get('origin');
    const requestPath = sanitizeRequestTarget(request.originalUrl ?? request.url);
    if (
      origin &&
      requiresAllowedBrowserOrigin(request.method, requestPath) &&
      !isBrowserOriginAllowed(origin, config)
    )
      return response.status(403).type('application/problem+json').send({
        type: 'https://coda.local/problems/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Request origin is not allowed',
      });
    next();
  });
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
  if (config.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Coda API')
        .setVersion('1')
        .addCookieAuth(config.SESSION_COOKIE_NAME)
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
  await app.get(SetupTokenService).bootstrap();
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
