import { timingSafeEqual } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';
import { hashToken } from '../common/crypto';
import type { MetricsService } from './metrics.service';

interface ExpressGetMethod {
  get(path: string, handler: RequestHandler): unknown;
}

const BEARER_PREFIX = 'Bearer ';

function problem(response: Response, status: number, title: string, detail: string): void {
  response
    .status(status)
    .type('application/problem+json')
    .send({ type: `https://coda.local/problems/${status}`, title, status, detail });
}

function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith(BEARER_PREFIX)) return undefined;
  const token = value.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

/** Constant-time comparison over fixed-length hashes, regardless of the presented token's length. */
function tokensMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(hashToken(provided), 'hex'),
    Buffer.from(hashToken(expected), 'hex'),
  );
}

/**
 * Builds the `/metrics` handler. Registered directly on the underlying HTTP adapter in
 * `main.ts` — never as a Nest controller — so it bypasses Nest's guard pipeline, the
 * SPA static fallback, and Swagger/OpenAPI document generation entirely.
 *
 * `token` is `env().METRICS_TOKEN`, read once at bootstrap: unset means the route
 * responds 404 (it does not exist) rather than 401, matching the disabled-by-default
 * contract.
 */
export function createMetricsRoute(
  metrics: MetricsService,
  token: string | undefined,
): RequestHandler {
  return (request: Request, response: Response, next: (error?: unknown) => void): void => {
    if (!token) {
      problem(response, 404, 'Not Found', 'Metrics are disabled on this instance');
      return;
    }
    const provided = bearerToken(request.headers.authorization);
    if (!provided || !tokensMatch(provided, token)) {
      problem(response, 401, 'Unauthorized', 'A valid metrics bearer token is required');
      return;
    }
    metrics
      .render()
      .then((body) => {
        // Bypass res.send()/res.type(): both reformat the Content-Type header (via the
        // `content-type` package's parameter reordering), which would mangle prom-client's
        // exact, spec-mandated Prometheus exposition content type. res.end() writes the
        // header and body as given.
        response.status(200).setHeader('Content-Type', metrics.contentType);
        response.end(body);
      })
      .catch(next);
  };
}

/**
 * Registers the handler directly on the underlying Express instance as a `GET`-only,
 * exact-path route — not through Nest's controller/module system — so it takes effect
 * ahead of the ServeStaticModule SPA fallback and is never scanned by Swagger/OpenAPI
 * document generation.
 */
export function registerMetricsRoute(
  app: Pick<INestApplication, 'getHttpAdapter'>,
  handler: RequestHandler,
): void {
  (app.getHttpAdapter().getInstance() as ExpressGetMethod).get('/metrics', handler);
}
