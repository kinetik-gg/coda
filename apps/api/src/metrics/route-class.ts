import type { Request } from 'express';
import { sanitizeRequestTarget } from '../common/request-target';

/**
 * Bounded-cardinality route labels for the HTTP metrics histogram. Prometheus labels
 * must never carry raw, attacker- or user-influenced path segments (screenplay ids,
 * project ids, probe traffic for nonexistent routes, …) or the label set grows without
 * bound. Every branch below collapses to a small, fixed vocabulary.
 */
const METRICS_ROUTE_CLASS = 'metrics';
const UNMATCHED_API_ROUTE_CLASS = 'unmatched';
const STATIC_ROUTE_CLASS = 'static';
const METRICS_PATH = '/metrics';
const API_PATH_PREFIX = '/api/';

type RouteRequest = Pick<Request, 'route' | 'baseUrl' | 'originalUrl' | 'url'>;

function isWildcardPattern(path: string): boolean {
  return path.includes('*');
}

/**
 * When Express/Nest matches a request to a registered route, `request.route.path`
 * holds the route's *pattern* (e.g. `/api/v1/screenplays/:screenplayId`), not the
 * concrete request path. That pattern is exactly the bounded label we want: reusing
 * it means every real API endpoint gets its own precise, finite label for free,
 * without any bespoke id-detection regex to keep in sync as routes evolve.
 */
function matchedRoutePattern(request: RouteRequest): string | undefined {
  const route = request.route as { path?: unknown } | undefined;
  const path = route?.path;
  if (typeof path !== 'string' || path.length === 0) return undefined;
  const base = request.baseUrl && request.baseUrl !== '/' ? request.baseUrl : '';
  return `${base}${path}`;
}

/**
 * Classifies a request into a bounded route label for the HTTP duration histogram.
 * Never returns a raw request path: unmatched routes (404s, probing) and the SPA
 * fallback both collapse into fixed constants.
 */
export function classifyRoute(request: RouteRequest): string {
  const pattern = matchedRoutePattern(request);
  if (pattern !== undefined) return isWildcardPattern(pattern) ? STATIC_ROUTE_CLASS : pattern;

  const pathname = sanitizeRequestTarget(request.originalUrl ?? request.url);
  if (pathname === METRICS_PATH) return METRICS_ROUTE_CLASS;
  return pathname.startsWith(API_PATH_PREFIX) || pathname === '/api'
    ? UNMATCHED_API_ROUTE_CLASS
    : STATIC_ROUTE_CLASS;
}
