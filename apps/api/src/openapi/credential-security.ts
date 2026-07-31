import {
  CREDENTIAL_PROJECT_ROOT_TEMPLATE,
  isCredentialAllowedRootRoute,
  isProjectScopedCredentialSuffixAllowed,
} from '../auth/session.guard';

type JsonObject = Record<string, unknown>;

const bearerSecurity: JsonObject[] = [{ bearerAuth: [] }];

/**
 * Whether `session.guard.ts`'s bearer-credential allowlist covers a
 * templated OpenAPI path (e.g. `/api/v1/projects/{projectId}/items`) for
 * `method`. Reuses the exact predicate the guard enforces at runtime, since
 * a templated path's `{param}` segments are still single, slash-free path
 * segments and match the same suffix rules a live request path would.
 */
export function isCredentialAllowedForTemplatedPath(
  method: string,
  templatedPath: string,
): boolean {
  if (isCredentialAllowedRootRoute(method, templatedPath)) return true;
  if (!templatedPath.startsWith(CREDENTIAL_PROJECT_ROOT_TEMPLATE)) return false;
  const suffix = templatedPath.slice(CREDENTIAL_PROJECT_ROOT_TEMPLATE.length);
  return isProjectScopedCredentialSuffixAllowed(method, suffix);
}

/**
 * Derives the OpenAPI `security` requirement for an operation that did not
 * specify one explicitly, from the session guard's credential allowlist.
 * Throws instead of guessing so a newly added project-scoped route can
 * never publish an unreviewed bearer grant: an author must either add the
 * route to `credentialRouteAllowed`'s allowlist (if a credential should
 * reach it) or give the operation an explicit `security` override (if it is
 * session-only), keeping the published document and the runtime guard from
 * drifting apart.
 */
export function deriveDefaultOperationSecurity(
  method: string,
  templatedPath: string,
): JsonObject[] {
  if (isCredentialAllowedForTemplatedPath(method, templatedPath)) return bearerSecurity;
  throw new Error(
    `No explicit OpenAPI security override and no credential-allowlist match for ${method} ${templatedPath}. ` +
      'Add an explicit `security` override in external-openapi.ts if this route is session-only, ' +
      'or add it to the allowlist in session.guard.ts if a bearer credential should reach it.',
  );
}

const HTTP_METHODS = new Set(['get', 'post', 'patch', 'put', 'delete']);

/**
 * Fills in `security` for every operation in a built OpenAPI `paths` object
 * that did not specify one explicitly, deriving it from the session
 * guard's credential allowlist. Intended to run once at module load, so a
 * newly added route missing both an explicit override and an allowlist
 * entry fails fast instead of silently publishing bearer access the guard
 * would reject at runtime.
 */
export function applyDerivedSecurity(paths: JsonObject): void {
  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    const methodsObject = methods as JsonObject;
    for (const [method, operationValue] of Object.entries(methodsObject)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!operationValue || typeof operationValue !== 'object') continue;
      const operationObject = operationValue as JsonObject;
      if (operationObject.security !== undefined) continue;
      const security = deriveDefaultOperationSecurity(method.toUpperCase(), path);
      // Insert `security` right after `tags`, matching the position `operation()`
      // gives an explicit override, so a derived route renders identically to one
      // whose security was authored inline instead of appended at the end.
      const { operationId, summary, tags, ...rest } = operationObject;
      methodsObject[method] = { operationId, summary, tags, security, ...rest };
    }
  }
}
