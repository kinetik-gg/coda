import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SessionGuard } from './session.guard';

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;
}

const credential = {
  resourceType: 'project' as const,
  id: '10000000-0000-4000-8000-000000000001',
  projectId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  kind: 'API_KEY',
  permissions: ['read_project'],
} as const;

const trackerCredential = {
  resourceType: 'tracker' as const,
  id: '10000000-0000-4000-8000-000000000001',
  trackerId: '10000000-0000-4000-8000-000000000004',
  userId: '10000000-0000-4000-8000-000000000003',
  kind: 'MCP_TOKEN',
  permissions: ['read_tracker', 'edit_tracker_records'],
} as const;

describe('SessionGuard bearer boundaries', () => {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };

  it('allows a bound project resource', () => {
    const guard = new SessionGuard(reflector as never);
    const request = {
      method: 'GET',
      path: `/api/v1/projects/${credential.projectId}/items`,
      params: { projectId: credential.projectId },
      user: { id: credential.userId },
      apiCredential: credential,
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
  });

  it('allows the documented project update route', () => {
    const guard = new SessionGuard(reflector as never);
    const request = {
      method: 'PATCH',
      path: `/api/v1/projects/${credential.projectId}`,
      params: { projectId: credential.projectId },
      user: { id: credential.userId },
      apiCredential: credential,
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
  });

  it('blocks bearer access to account and credential management', () => {
    const guard = new SessionGuard(reflector as never);
    const request = {
      method: 'GET',
      path: '/api/v1/account/credentials',
      params: {},
      user: { id: credential.userId },
      apiCredential: credential,
    };

    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it('blocks setup even when the endpoint is otherwise public', () => {
    const publicReflector = { getAllAndOverride: vi.fn().mockReturnValue(true) };
    const guard = new SessionGuard(publicReflector as never);
    const request = {
      method: 'GET',
      path: '/api/v1/setup/status',
      params: {},
      user: { id: credential.userId },
      apiCredential: credential,
    };

    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it('blocks workspace preferences and ownership transfer', () => {
    const guard = new SessionGuard(reflector as never);
    for (const suffix of ['workspace-layout', 'transfer-ownership']) {
      const request = {
        method: suffix === 'transfer-ownership' ? 'POST' : 'GET',
        path: `/api/v1/projects/${credential.projectId}/${suffix}`,
        params: { projectId: credential.projectId },
        user: { id: credential.userId },
        apiCredential: credential,
      };
      expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
    }
  });

  it.each([
    ['GET', 'management'],
    ['POST', 'invitations'],
    ['POST', 'roles'],
    ['DELETE', 'memberships/member-id'],
    ['GET', 'trash'],
  ])('blocks internal project route %s %s', (method, suffix) => {
    const guard = new SessionGuard(reflector as never);
    const request = {
      method,
      path: `/api/v1/projects/${credential.projectId}/${suffix}`,
      params: { projectId: credential.projectId },
      user: { id: credential.userId },
      apiCredential: credential,
    };
    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it('rejects a method that is not published for an otherwise valid resource path', () => {
    const guard = new SessionGuard(reflector as never);
    const request = {
      method: 'DELETE',
      path: `/api/v1/projects/${credential.projectId}/items/item-id`,
      params: { projectId: credential.projectId },
      user: { id: credential.userId },
      apiCredential: credential,
    };
    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it('hides a project outside the credential scope', () => {
    const guard = new SessionGuard(reflector as never);
    const otherProjectId = '90000000-0000-4000-8000-000000000009';
    const request = {
      method: 'GET',
      path: `/api/v1/projects/${otherProjectId}/items`,
      params: { projectId: otherProjectId },
      user: { id: credential.userId },
      apiCredential: credential,
    };
    expect(() => guard.canActivate(contextFor(request))).toThrow(NotFoundException);
  });
});

describe('SessionGuard tracker-credential boundaries', () => {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
  const trackerRoot = `/api/v1/trackers/${trackerCredential.trackerId}`;

  const requestFor = (
    method: string,
    path: string,
    params: Record<string, string> = { trackerId: trackerCredential.trackerId },
  ) => ({
    method,
    path,
    params,
    user: { id: trackerCredential.userId },
    apiCredential: trackerCredential,
  });

  const admitted: ReadonlyArray<[string, string]> = [
    ['GET', trackerRoot],
    ['PATCH', trackerRoot],
    ['GET', `${trackerRoot}/fields`],
    ['POST', `${trackerRoot}/fields`],
    ['GET', `${trackerRoot}/fields/field-1`],
    ['PATCH', `${trackerRoot}/fields/field-1`],
    ['DELETE', `${trackerRoot}/fields/field-1`],
    ['PATCH', `${trackerRoot}/fields/field-1/reorder`],
    ['GET', `${trackerRoot}/records`],
    ['POST', `${trackerRoot}/records`],
    ['GET', `${trackerRoot}/records/record-1`],
    ['PATCH', `${trackerRoot}/records/record-1`],
    ['PATCH', `${trackerRoot}/records/record-1/reorder`],
    ['PUT', `${trackerRoot}/records/record-1/fields/field-1`],
    ['GET', `${trackerRoot}/records/record-1/comments`],
    ['POST', `${trackerRoot}/records/record-1/comments`],
    ['PATCH', `${trackerRoot}/records/record-1/comments/comment-1`],
    ['GET', `${trackerRoot}/activity`],
    ['POST', `${trackerRoot}/uploads/upload-1/complete`],
    ['GET', `${trackerRoot}/storage-objects/upload-1/content`],
    ['GET', `${trackerRoot}/exports/grid.csv`],
    ['GET', '/api/v1/token/context'],
    ['POST', '/api/v1/uploads'],
  ];

  it.each(admitted)('admits %s %s for the bound tracker', (method, path) => {
    const guard = new SessionGuard(reflector as never);
    const params: Record<string, string> = path.startsWith(trackerRoot)
      ? { trackerId: trackerCredential.trackerId }
      : {};
    expect(guard.canActivate(contextFor(requestFor(method, path, params)))).toBe(true);
  });

  it.each([
    ['POST', '/records/bulk-set'],
    ['POST', '/records/bulk-delete'],
    ['POST', '/fields/field-1/options'],
    ['PATCH', '/fields/field-1/options/option-1'],
    ['DELETE', '/fields/field-1/options/option-1'],
    ['DELETE', '/records/record-1/comments/comment-1'],
    ['GET', '/workspace-layout'],
    ['PUT', '/workspace-layout'],
    ['POST', '/workspace-layout/reset'],
    ['POST', '/workspace-layout/publish'],
    ['GET', '/management'],
    ['POST', '/memberships'],
    ['PATCH', '/memberships/member-1'],
    ['DELETE', '/memberships/member-1'],
    ['POST', '/roles'],
    ['PATCH', '/roles/role-1'],
    ['DELETE', '/roles/role-1'],
    ['POST', '/invitations'],
    ['DELETE', '/invitations/invitation-1'],
    ['GET', '/available-users'],
    ['POST', '/transfer-ownership'],
  ] as const)('blocks session-only tracker route %s %s', (method, suffix) => {
    const guard = new SessionGuard(reflector as never);
    expect(() =>
      guard.canActivate(
        contextFor(
          requestFor(method, `${trackerRoot}${suffix}`, { trackerId: trackerCredential.trackerId }),
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('blocks tracker deletion like the project lifecycle family', () => {
    const guard = new SessionGuard(reflector as never);
    expect(() => guard.canActivate(contextFor(requestFor('DELETE', trackerRoot)))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks collection listing and creation for a bound tracker', () => {
    const guard = new SessionGuard(reflector as never);
    for (const [method, path] of [
      ['GET', '/api/v1/trackers'],
      ['POST', '/api/v1/trackers'],
    ] as const) {
      expect(() =>
        guard.canActivate(contextFor(requestFor(method, path, {}))),
      ).toThrow(ForbiddenException);
    }
  });

  it('hides another tracker behind 404 before any allowlist check', () => {
    const guard = new SessionGuard(reflector as never);
    const otherTrackerId = '90000000-0000-4000-8000-000000000009';
    expect(() =>
      guard.canActivate(
        contextFor(
          requestFor('GET', `/api/v1/trackers/${otherTrackerId}/records`, {
            trackerId: otherTrackerId,
          }),
        ),
      ),
    ).toThrow(NotFoundException);
  });

  it('never lets a tracker credential address a project route', () => {
    const guard = new SessionGuard(reflector as never);
    expect(() =>
      guard.canActivate(
        contextFor(
          requestFor('GET', `/api/v1/projects/${credential.projectId}/items`, {
            projectId: credential.projectId,
          }),
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('never lets a project credential address a tracker route', () => {
    const guard = new SessionGuard(reflector as never);
    const request = {
      method: 'GET',
      path: trackerRoot,
      params: { trackerId: trackerCredential.trackerId },
      user: { id: credential.userId },
      apiCredential: credential,
    };
    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });
});
