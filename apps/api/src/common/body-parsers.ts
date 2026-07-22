import type { INestApplication } from '@nestjs/common';
import {
  json,
  urlencoded,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import {
  hydrateSessionRequest,
  SESSION_TOKEN_PATTERN,
  type ActiveSession,
} from '../auth/session-authentication';

export const DEFAULT_REQUEST_BODY_LIMIT = '100kb';

export interface ScreenplayBodyParserOptions {
  sessionCookieName: string;
  maxBytes: number;
  maxConcurrent: number;
  timeoutMs: number;
  verifySession: (token: string) => Promise<ActiveSession | null>;
}

function problem(response: Response, status: number, detail: string): void {
  response.setHeader('Cache-Control', 'private,no-store');
  response.setHeader('Vary', 'Cookie');
  response
    .status(status)
    .type('application/problem+json')
    .send({
      type: `https://coda.local/problems/${status}`,
      title:
        status === 401
          ? 'Unauthorized'
          : status === 408
            ? 'Request Timeout'
            : status === 413
              ? 'Payload Too Large'
              : status === 503
                ? 'Service Unavailable'
                : 'Bad Request',
      status,
      detail,
    });
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return undefined;
  for (const entry of cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return undefined;
}

export function createScreenplayBodyMiddleware(
  options: ScreenplayBodyParserOptions,
  parser: RequestHandler = json({ limit: options.maxBytes, strict: true }),
): RequestHandler {
  let active = 0;
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST' && request.method !== 'PATCH') return next();
    const token = cookieValue(request, options.sessionCookieName);
    if (request.headers.authorization || !token || !SESSION_TOKEN_PATTERN.test(token)) {
      problem(response, 401, 'Authentication required');
      return;
    }
    const header = request.headers['content-length'];
    if (header !== undefined) {
      if (typeof header !== 'string' || !/^\d+$/u.test(header)) {
        problem(response, 400, 'Content-Length must be a non-negative integer');
        return;
      }
      const length = Number(header);
      if (!Number.isSafeInteger(length)) {
        problem(response, 400, 'Content-Length is outside the supported range');
        return;
      }
      if (length > options.maxBytes) {
        problem(response, 413, 'Screenplay request body exceeds the configured byte limit');
        return;
      }
    }
    if (active >= options.maxConcurrent) {
      response.setHeader('Retry-After', '1');
      problem(response, 503, 'Screenplay body parsing is at capacity; retry shortly');
      return;
    }

    active += 1;
    let released = false;
    let abandoned = false;
    let timedOut = false;
    const onClose = () => {
      abandoned = true;
      release();
    };
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
      clearTimeout(timer);
      response.off('close', onClose);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      release();
      if (!response.headersSent) {
        response.once('finish', () => request.destroy());
        problem(response, 408, 'Screenplay request body timed out');
      } else {
        request.destroy();
      }
    }, options.timeoutMs);
    timer.unref();
    response.once('close', onClose);
    void options
      .verifySession(token)
      .then((session) => {
        if (timedOut || abandoned) return;
        if (!session) {
          release();
          problem(response, 401, 'Authentication required');
          return;
        }
        hydrateSessionRequest(request, session);
        request.sessionAdmissionAuthenticated = true;
        parser(request, response, (error?: unknown) => {
          release();
          if (timedOut || abandoned) return;
          next(error);
        });
      })
      .catch(() => {
        release();
        if (!timedOut && !abandoned && !response.headersSent) {
          problem(response, 503, 'Authentication is temporarily unavailable');
        }
      });
  };
}

export function installBodyParsers(
  application: Pick<INestApplication, 'use'>,
  options: ScreenplayBodyParserOptions,
): void {
  application.use('/api/v1/screenplays', createScreenplayBodyMiddleware(options));
  application.use(json({ limit: DEFAULT_REQUEST_BODY_LIMIT, strict: true }));
  application.use(
    urlencoded({ limit: DEFAULT_REQUEST_BODY_LIMIT, extended: true, parameterLimit: 1_000 }),
  );
}
