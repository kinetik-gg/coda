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
  id: '10000000-0000-4000-8000-000000000001',
  projectId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  kind: 'API_KEY',
  permissions: ['read_project'],
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
