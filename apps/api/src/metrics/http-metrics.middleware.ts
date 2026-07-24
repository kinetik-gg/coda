import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Histogram } from 'prom-client';
import { classifyRoute } from './route-class';

export type HttpDurationHistogram = Histogram<'method' | 'route' | 'status'>;

/**
 * Records request duration for every request, regardless of how it terminates
 * (Nest controller, guard rejection, static asset, SPA fallback, or a raw Express
 * route such as `/metrics`). Work per request is one `hrtime` read, one `finish`
 * listener, and one label lookup on completion — no synchronous I/O and nothing
 * that can delay the response, so it adds no measurable latency to user requests.
 */
export function createHttpMetricsMiddleware(histogram: HttpDurationHistogram): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    response.once('finish', () => {
      const elapsedNs = process.hrtime.bigint() - start;
      histogram.observe(
        {
          method: request.method,
          route: classifyRoute(request),
          status: String(response.statusCode),
        },
        Number(elapsedNs) / 1e9,
      );
    });
    next();
  };
}
