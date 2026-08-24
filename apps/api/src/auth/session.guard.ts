import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_ROUTE } from './public.decorator';

/**
 * Routes a bearer credential (API key or MCP token) may reach outside a resource root. This is
 * the single source of truth consumed both here (to enforce access) and by the external OpenAPI
 * document builder (to derive published `security` requirements), so the published contract
 * cannot silently drift from what the guard allows.
 */
export const CREDENTIAL_ALLOWED_ROOT_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/v1/token/context' },
  { method: 'GET', path: '/api/v1/openapi.json' },
  { method: 'POST', path: '/api/v1/uploads' },
];

/** The templated root a bearer credential's project-scoped access is rooted at. */
export const CREDENTIAL_PROJECT_ROOT_TEMPLATE = '/api/v1/projects/{projectId}';

const PROJECT_SCOPED_EXACT_SUFFIXES = new Set([
  'GET ',
  'PATCH ',
  'POST /entity-types',
  'GET /items',
  'POST /items',
  'POST /fields',
  'POST /source-documents',
  'GET /activity',
]);

const PROJECT_SCOPED_SUFFIX_RULES: ReadonlyArray<[string, RegExp]> = [
  ['PATCH', /^\/entity-types\/[^/]+$/],
  ['DELETE', /^\/entity-types\/[^/]+$/],
  ['PATCH', /^\/items\/[^/]+$/],
  ['PATCH', /^\/items\/[^/]+\/reorder$/],
  ['GET', /^\/entity-types\/[^/]+\/fields$/],
  ['GET', /^\/fields\/[^/]+$/],
  ['PATCH', /^\/fields\/[^/]+$/],
  ['PATCH', /^\/fields\/[^/]+\/reorder$/],
  ['PUT', /^\/items\/[^/]+\/fields\/[^/]+$/],
  ['POST', /^\/uploads\/[^/]+\/complete$/],
  ['GET', /^\/storage-objects\/[^/]+\/content$/],
  ['POST', /^\/items\/[^/]+\/source-references$/],
  ['GET', /^\/items\/[^/]+\/comments$/],
  ['POST', /^\/items\/[^/]+\/comments$/],
  ['PATCH', /^\/comments\/[^/]+$/],
  ['GET', /^\/exports\/levels\/[^/]+\.csv$/],
  ['GET', /^\/exports\/project\.json$/],
];

/**
 * Whether a bearer credential may reach `suffix` (the path remaining after
 * `/api/v1/projects/{projectId}` is stripped) with `method`. Pure and
 * placeholder-safe: `suffix` may contain literal `{paramName}` segments, so
 * this same predicate works against both a live request path and a
 * templated OpenAPI path.
 */
export function isProjectScopedCredentialSuffixAllowed(method: string, suffix: string): boolean {
  if (PROJECT_SCOPED_EXACT_SUFFIXES.has(`${method} ${suffix}`)) return true;
  return PROJECT_SCOPED_SUFFIX_RULES.some(
    ([allowedMethod, pattern]) => method === allowedMethod && pattern.test(suffix),
  );
}

/** The templated root a bearer credential's tracker-scoped access is rooted at. */
export const CREDENTIAL_TRACKER_ROOT_TEMPLATE = '/api/v1/trackers/{trackerId}';

/**
 * The tracker mirror of the project suffix set: exactly the families the project allowlist
 * admits, mapped one-to-one onto the tracker aggregate (`items`→`records`, hierarchy levels
 * collapse into the flat field list). Families with no admitted project equivalent stay OUT:
 * bulk writes, field options, comment deletion, workspace layouts, and the whole sharing family.
 * Exports admit the family rather than exact filenames because the tracker export routes are
 * owned by the parallel export batch.
 */
const TRACKER_SCOPED_EXACT_SUFFIXES = new Set([
  'GET ',
  'PATCH ',
  'POST /fields',
  'GET /fields',
  'GET /records',
  'POST /records',
  'GET /activity',
]);

const TRACKER_SCOPED_SUFFIX_RULES: ReadonlyArray<[string, RegExp]> = [
  ['GET', /^\/fields\/[^/]+$/],
  ['PATCH', /^\/fields\/[^/]+$/],
  ['DELETE', /^\/fields\/[^/]+$/],
  ['PATCH', /^\/fields\/[^/]+\/reorder$/],
  ['GET', /^\/records\/[^/]+$/],
  ['PATCH', /^\/records\/[^/]+$/],
  ['PATCH', /^\/records\/[^/]+\/reorder$/],
  ['PUT', /^\/records\/[^/]+\/fields\/[^/]+$/],
  ['GET', /^\/records\/[^/]+\/comments$/],
  ['POST', /^\/records\/[^/]+\/comments$/],
  // The tracker twin of the project's flattened `PATCH /comments/{commentId}`.
  ['PATCH', /^\/records\/[^/]+\/comments\/[^/]+$/],
  ['POST', /^\/uploads\/[^/]+\/complete$/],
  ['GET', /^\/storage-objects\/[^/]+\/content$/],
  ['GET', /^\/exports\//],
];

/**
 * The tracker twin of {@link isProjectScopedCredentialSuffixAllowed}: same contract, same
 * placeholder safety.
 */
export function isTrackerScopedCredentialSuffixAllowed(method: string, suffix: string): boolean {
  if (TRACKER_SCOPED_EXACT_SUFFIXES.has(`${method} ${suffix}`)) return true;
  return TRACKER_SCOPED_SUFFIX_RULES.some(
    ([allowedMethod, pattern]) => method === allowedMethod && pattern.test(suffix),
  );
}

/** Whether a bearer credential may reach `path` outside a resource root. */
export function isCredentialAllowedRootRoute(method: string, path: string): boolean {
  return CREDENTIAL_ALLOWED_ROOT_ROUTES.some(
    (route) => route.method === method && route.path === path,
  );
}

function credentialRouteAllowed(request: Request, projectId: string): boolean {
  const method = request.method.toUpperCase();
  if (isCredentialAllowedRootRoute(method, request.path)) return true;

  const root = `/api/v1/projects/${projectId}`;
  if (!request.path.startsWith(root)) return false;
  const suffix = request.path.slice(root.length);
  return isProjectScopedCredentialSuffixAllowed(method, suffix);
}

function trackerCredentialRouteAllowed(request: Request, trackerId: string): boolean {
  const method = request.method.toUpperCase();
  if (isCredentialAllowedRootRoute(method, request.path)) return true;

  const root = `/api/v1/trackers/${trackerId}`;
  if (!request.path.startsWith(root)) return false;
  const suffix = request.path.slice(root.length);
  return isTrackerScopedCredentialSuffixAllowed(method, suffix);
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.authenticationFailure) {
      throw new UnauthorizedException(request.authenticationFailure);
    }
    if (request.apiCredential) {
      enforceCredentialScope(request);
    }
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    if (!request.user) throw new UnauthorizedException('Authentication required');
    return true;
  }
}

function enforceCredentialScope(request: Request): void {
  const credential = request.apiCredential!;
  if (credential.resourceType === 'project') {
    if (request.params.projectId && request.params.projectId !== credential.projectId) {
      throw new NotFoundException('Project not found');
    }
    if (!credentialRouteAllowed(request, credential.projectId)) {
      throw new ForbiddenException('Bearer credentials cannot access this endpoint');
    }
    return;
  }
  if (request.params.trackerId && request.params.trackerId !== credential.trackerId) {
    throw new NotFoundException('Tracker not found');
  }
  if (!trackerCredentialRouteAllowed(request, credential.trackerId)) {
    throw new ForbiddenException('Bearer credentials cannot access this endpoint');
  }
}
