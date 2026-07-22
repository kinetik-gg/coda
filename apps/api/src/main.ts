import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { type Request, type Response, type NextFunction } from 'express';
import { AppModule } from './app.module';
import { BigIntSerializerInterceptor } from './common/bigint.interceptor';
import { installBodyParsers } from './common/body-parsers';
import { sanitizeRequestTarget } from './common/request-target';
import { isBrowserOriginAllowed } from './config/browser-origin';
import { env } from './config/env';
import { configureTrustedProxies } from './config/trusted-proxies';
import { PrismaService } from './prisma/prisma.service';
import { findActiveSession } from './auth/session-authentication';

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
  const secureOrigin = new URL(config.APP_ORIGIN).protocol === 'https:';
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  configureTrustedProxies(app, config.TRUSTED_PROXY_CIDRS);
  const prisma = app.get(PrismaService);
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
        err: (error: unknown) => ({
          type: error instanceof Error ? error.name : 'Error',
          message: 'Request failed',
        }),
      },
    }),
  );
  app.use((request: Request, response: Response, next: NextFunction) => {
    request.requestId = typeof request.id === 'string' ? request.id : randomUUID();
    response.setHeader('x-request-id', request.requestId);
    const origin = request.get('origin');
    if (origin && !isBrowserOriginAllowed(origin, config))
      return response.status(403).type('application/problem+json').send({
        type: 'https://coda.local/problems/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Request origin is not allowed',
      });
    next();
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
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
