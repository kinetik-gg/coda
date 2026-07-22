import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { text, type Request, type Response, type NextFunction } from 'express';
import { AppModule } from './app.module';
import { BigIntSerializerInterceptor } from './common/bigint.interceptor';
import { sanitizeRequestTarget } from './common/request-target';
import { env } from './config/env';
import { MAX_PROJECT_IMPORT_BYTES } from './imports/project-import.schema';
import { PROJECT_IMPORT_MEDIA_TYPE } from './imports/project-imports.controller';

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
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(text({ type: PROJECT_IMPORT_MEDIA_TYPE, limit: MAX_PROJECT_IMPORT_BYTES }));
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
      contentSecurityPolicy:
        config.NODE_ENV === 'production'
          ? {
              directives: {
                connectSrc: ["'self'", new URL(config.S3_PUBLIC_ENDPOINT).origin],
                upgradeInsecureRequests: secureOrigin ? [] : null,
              },
            }
          : false,
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
    if (origin && origin !== config.APP_ORIGIN)
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
