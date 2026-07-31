import { describe, expect, it } from 'vitest';
import {
  applyDerivedSecurity,
  deriveDefaultOperationSecurity,
  isCredentialAllowedForTemplatedPath,
} from './credential-security';

describe('credential-security', () => {
  it('derives bearerAuth for a project-scoped route the guard allowlist covers', () => {
    expect(isCredentialAllowedForTemplatedPath('GET', '/api/v1/projects/{projectId}/items')).toBe(
      true,
    );
    expect(deriveDefaultOperationSecurity('GET', '/api/v1/projects/{projectId}/items')).toEqual([
      { bearerAuth: [] },
    ]);
  });

  it('derives bearerAuth for the documented root routes outside the project scope', () => {
    expect(isCredentialAllowedForTemplatedPath('GET', '/api/v1/token/context')).toBe(true);
    expect(isCredentialAllowedForTemplatedPath('POST', '/api/v1/uploads')).toBe(true);
  });

  it('rejects a route the guard allowlist does not cover', () => {
    expect(isCredentialAllowedForTemplatedPath('GET', '/api/v1/screenplays/{screenplayId}')).toBe(
      false,
    );
    expect(() =>
      deriveDefaultOperationSecurity('GET', '/api/v1/screenplays/{screenplayId}'),
    ).toThrow(/credential-allowlist/);
  });

  it('fails fast instead of publishing an unreviewed bearer grant', () => {
    const paths = {
      '/api/v1/screenplays/{screenplayId}': {
        get: { operationId: 'getScreenplay' },
      },
    };

    expect(() => applyDerivedSecurity(paths)).toThrow(
      /No explicit OpenAPI security override and no credential-allowlist match/,
    );
  });

  it('leaves operations with an explicit security override untouched', () => {
    const paths: Record<string, Record<string, { operationId: string; security?: unknown }>> = {
      '/api/v1/screenplays/{screenplayId}': {
        get: { operationId: 'getScreenplay', security: [{ sessionCookie: [] }] },
      },
      '/api/v1/projects/{projectId}/items': {
        get: { operationId: 'listItems' },
      },
    };

    applyDerivedSecurity(paths);

    expect(paths['/api/v1/screenplays/{screenplayId}']!.get!.security).toEqual([
      { sessionCookie: [] },
    ]);
    expect(paths['/api/v1/projects/{projectId}/items']!.get!.security).toEqual([
      { bearerAuth: [] },
    ]);
  });
});
