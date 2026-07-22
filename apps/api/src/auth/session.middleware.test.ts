import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({
  env: () => ({ SESSION_COOKIE_NAME: 'coda_session' }),
}));

import { SessionMiddleware } from './session.middleware';

function requestWith(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  return {
    cookies,
    get: vi.fn((name: string) => headers[name.toLowerCase()]),
  } as unknown as Request;
}

function middlewareWith(session: unknown = null) {
  const prisma = { session: { findUnique: vi.fn().mockResolvedValue(session) } };
  const credentials = { authenticate: vi.fn() };
  const authContext = {
    run: vi.fn((_context: unknown, callback: NextFunction) => callback()),
  };
  return {
    prisma,
    credentials,
    authContext,
    middleware: new SessionMiddleware(prisma as never, credentials as never, authContext as never),
  };
}

describe('SessionMiddleware authentication routing', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it.each([
    ['api', 'API_KEY'],
    ['mcp', 'MCP_TOKEN'],
  ] as const)(
    'authenticates a valid %s bearer credential for its audience',
    async (audience, kind) => {
      const { middleware, credentials, authContext } = middlewareWith();
      const request = requestWith({
        authorization: 'Bearer valid_token',
        'x-coda-token-audience': audience,
      });
      credentials.authenticate.mockResolvedValue({
        user: { id: 'user-1' },
        credential: { id: 'credential-1', kind },
      });

      await middleware.use(request, {} as Response, next);

      expect(credentials.authenticate).toHaveBeenCalledWith('valid_token', kind);
      expect(request).toMatchObject({
        user: { id: 'user-1' },
        apiCredential: { id: 'credential-1', kind },
        authenticationType: 'credential',
      });
      expect(authContext.run).toHaveBeenCalledWith({ credential: request.apiCredential }, next);
    },
  );

  it.each([
    ['Basic token', 'api'],
    ['Bearer valid_token', 'unknown'],
  ])('rejects malformed bearer routing without authenticating', async (authorization, audience) => {
    const { middleware, credentials } = middlewareWith();
    const request = requestWith({ authorization, 'x-coda-token-audience': audience });

    await middleware.use(request, {} as Response, next);

    expect(credentials.authenticate).not.toHaveBeenCalled();
    expect(request.authenticationFailure).toBe('Bearer credential is invalid');
    expect(next).toHaveBeenCalledOnce();
  });

  it('records authentication failure when credential verification rejects', async () => {
    const { middleware, credentials } = middlewareWith();
    credentials.authenticate.mockRejectedValue(new Error('revoked'));
    const request = requestWith({ authorization: 'Bearer revoked_token' });

    await middleware.use(request, {} as Response, next);

    expect(request.authenticationFailure).toBe('Bearer credential is invalid');
    expect(request.user).toBeUndefined();
  });

  it('hydrates an active, unexpired cookie session', async () => {
    const session = {
      id: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', status: 'ACTIVE' },
    };
    const { middleware, prisma, authContext } = middlewareWith(session);
    const request = requestWith({}, { coda_session: 'cookie-token' });

    await middleware.use(request, {} as Response, next);

    expect(prisma.session.findUnique).toHaveBeenCalledOnce();
    const lookup = prisma.session.findUnique.mock.calls[0]?.[0] as unknown as {
      where: { tokenHash: string };
    };
    expect(lookup.where.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(request).toMatchObject({
      user: session.user,
      sessionId: 'session-1',
      authenticationType: 'session',
    });
    expect(authContext.run).toHaveBeenCalledWith({}, next);
  });

  it.each([
    { expiresAt: new Date(Date.now() - 60_000), user: { status: 'ACTIVE' } },
    { expiresAt: new Date(Date.now() + 60_000), user: { status: 'SUSPENDED' } },
  ])('does not hydrate expired or inactive sessions', async (session) => {
    const { middleware } = middlewareWith({ id: 'session-1', ...session });
    const request = requestWith({}, { coda_session: 'cookie-token' });

    await middleware.use(request, {} as Response, next);

    expect(request.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('continues unauthenticated requests without querying sessions', async () => {
    const { middleware, prisma } = middlewareWith();
    const request = requestWith();
    await middleware.use(request, {} as Response, next);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
