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
export const SCREENPLAY_CHECKPOINT_BODY_LIMIT_BYTES = 1_024;

const checkpointPathPattern = /^\/api\/v1\/screenplays\/[^/?#]+\/checkpoints\/?(?:\?.*)?$/u;

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

type AdmissionRejection = 'client' | 'global' | 'session';
interface AdmissionReservation {
  authenticate: (sessionId: string) => AdmissionRejection | undefined;
  release: () => void;
}
type AdmissionResult = AdmissionReservation | { rejected: AdmissionRejection };

class ScreenplayBodyAdmission {
  private active = 0;
  private readonly activeByClient = new Map<string, number>();
  private readonly activeBySession = new Map<string, number>();
  private readonly maxPerIdentity: number;

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 2) {
      throw new RangeError('Screenplay body admission requires at least two global slots');
    }
    this.maxPerIdentity = maxConcurrent - 1;
  }

  acquire(clientKey: string): AdmissionResult {
    const clientActive = this.activeByClient.get(clientKey) ?? 0;
    if (clientActive >= this.maxPerIdentity) return { rejected: 'client' };
    if (this.active >= this.maxConcurrent) return { rejected: 'global' };

    this.active += 1;
    this.activeByClient.set(clientKey, clientActive + 1);
    let released = false;
    let authenticatedSession: string | undefined;
    const removeClient = () => {
      const remaining = (this.activeByClient.get(clientKey) ?? 1) - 1;
      if (remaining === 0) this.activeByClient.delete(clientKey);
      else this.activeByClient.set(clientKey, remaining);
    };
    return {
      authenticate: (sessionId) => {
        if (released) return 'global';
        removeClient();
        const sessionActive = this.activeBySession.get(sessionId) ?? 0;
        if (sessionActive >= this.maxPerIdentity) {
          released = true;
          this.active -= 1;
          return 'session';
        }
        authenticatedSession = sessionId;
        this.activeBySession.set(sessionId, sessionActive + 1);
        return undefined;
      },
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        if (!authenticatedSession) {
          removeClient();
          return;
        }
        const remaining = (this.activeBySession.get(authenticatedSession) ?? 1) - 1;
        if (remaining === 0) this.activeBySession.delete(authenticatedSession);
        else this.activeBySession.set(authenticatedSession, remaining);
      },
    };
  }
}

function admissionClientKey(request: Request): string {
  return request.ip || request.socket?.remoteAddress || 'unknown-client';
}

function requestBodyLimit(request: Request, options: ScreenplayBodyParserOptions): number {
  const target = request.originalUrl ?? request.url;
  return checkpointPathPattern.test(target)
    ? SCREENPLAY_CHECKPOINT_BODY_LIMIT_BYTES
    : options.maxBytes;
}

function rejectAdmission(response: Response, rejection: AdmissionRejection): void {
  response.setHeader('Retry-After', '1');
  problem(
    response,
    503,
    rejection === 'client'
      ? 'This client has too many screenplay bodies awaiting authentication; retry shortly'
      : rejection === 'session'
        ? 'This session has too many screenplay bodies in progress; retry shortly'
        : 'Screenplay body parsing is at capacity; retry shortly',
  );
}

export function createScreenplayBodyMiddleware(
  options: ScreenplayBodyParserOptions,
  sourceParser: RequestHandler = json({ limit: options.maxBytes, strict: true }),
  checkpointParser: RequestHandler = json({
    limit: SCREENPLAY_CHECKPOINT_BODY_LIMIT_BYTES,
    strict: true,
  }),
): RequestHandler {
  const admission = new ScreenplayBodyAdmission(options.maxConcurrent);
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
      if (length > requestBodyLimit(request, options)) {
        problem(response, 413, 'Screenplay request body exceeds the configured byte limit');
        return;
      }
    }
    const reservation = admission.acquire(admissionClientKey(request));
    if ('rejected' in reservation) {
      rejectAdmission(response, reservation.rejected);
      return;
    }

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
      reservation.release();
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
        const authenticationRejection = reservation.authenticate(session.id);
        if (authenticationRejection) {
          release();
          rejectAdmission(response, authenticationRejection);
          return;
        }
        hydrateSessionRequest(request, session);
        request.sessionAdmissionAuthenticated = true;
        const parser = checkpointPathPattern.test(request.originalUrl ?? request.url)
          ? checkpointParser
          : sourceParser;
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
