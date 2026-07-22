import express, { type NextFunction, type RequestHandler } from 'express';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { findActiveSession, type ActiveSession } from '../auth/session-authentication';
import { createScreenplayBodyMiddleware, installBodyParsers } from './body-parsers';

const validToken = 'a'.repeat(43);
const secondToken = 'b'.repeat(43);
const thirdToken = 'c'.repeat(43);
const fourthToken = 'd'.repeat(43);
const activeSession = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  tokenHash: '0'.repeat(64),
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  user: {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'writer@example.test',
    displayName: 'Writer',
    company: null,
    department: null,
    theme: 'coda-dark',
    fontSize: 'default',
    motionPreference: 'system',
    pdfAppearance: 'theme',
    status: 'ACTIVE',
  },
} satisfies ActiveSession;

const options = {
  sessionCookieName: 'coda_session',
  maxBytes: 1_000_000,
  maxConcurrent: 2,
  preAuthWindowMs: 60_000,
  preAuthMaxPerClient: 120,
  preAuthMaxGlobal: 1_200,
  timeoutMs: 5_000,
  verifySession: vi.fn().mockResolvedValue(activeSession),
};

function testApplication() {
  const application = express();
  installBodyParsers(application as unknown as Pick<INestApplication, 'use'>, options);
  application.post('/api/v1/screenplays/import', (request_, response) => {
    response.json({ length: (request_.body as { sourceText: string }).sourceText.length });
  });
  application.post('/api/v1/screenplays/:screenplayId/checkpoints', (request_, response) => {
    response.json(request_.body);
  });
  application.post('/api/v1/other', (_request, response) => response.sendStatus(204));
  return application;
}

function mockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    headersSent: false,
  };
}

describe('request body parsers', () => {
  it('accepts a feature-length screenplay body only after session verification', async () => {
    const response = await request(testApplication())
      .post('/api/v1/screenplays/import')
      .set('Cookie', `coda_session=${validToken}`)
      .send({ filename: 'feature.fountain', sourceText: 'A'.repeat(150_000) });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ length: 150_000 });
  });

  it('retains the conservative JSON limit for unrelated endpoints', async () => {
    const response = await request(testApplication())
      .post('/api/v1/other')
      .send({ value: 'A'.repeat(150_000) });

    expect(response.status).toBe(413);
  });

  it('uses a small route-specific limit for checkpoint creation', async () => {
    const accepted = await request(testApplication())
      .post('/api/v1/screenplays/screenplay-id/checkpoints')
      .set('Cookie', `coda_session=${validToken}`)
      .send({ version: 42 });
    const rejected = await request(testApplication())
      .post('/api/v1/screenplays/screenplay-id/checkpoints')
      .set('Cookie', `coda_session=${validToken}`)
      .send({ version: 42, padding: 'A'.repeat(1_024) });

    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ version: 42 });
    expect(rejected.status).toBe(413);
    expect(rejected.type).toBe('application/problem+json');
  });

  it('keeps the configured source limit on non-checkpoint screenplay routes', async () => {
    const response = await request(testApplication())
      .post('/api/v1/screenplays/import')
      .set('Cookie', `coda_session=${validToken}`)
      .send({ filename: 'draft.fountain', sourceText: 'A'.repeat(2_048) });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ length: 2_048 });
  });

  it.each([
    [{}, 401],
    [{ cookie: 'coda_session=invalid-shape' }, 401],
    [{ cookie: `coda_session=${validToken}`, 'content-length': '1000001' }, 413],
    [{ cookie: `coda_session=${validToken}`, 'content-length': 'invalid' }, 400],
    [{ cookie: `coda_session=${validToken}`, authorization: 'Bearer credential' }, 401],
  ])('rejects inadmissible screenplay bodies before invoking JSON parsing', (headers, status) => {
    const parser = vi.fn() as unknown as RequestHandler;
    const middleware = createScreenplayBodyMiddleware(options, parser);
    const response = mockResponse();

    middleware({ method: 'POST', headers } as never, response as never, vi.fn());

    expect(response.status).toHaveBeenCalledWith(status);
    expect(parser).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null],
    ['expired', { ...activeSession, expiresAt: new Date(Date.now() - 60_000) }],
    [
      'inactive',
      { ...activeSession, user: { ...activeSession.user, status: 'SUSPENDED' as const } },
    ],
  ])('does not parse a well-shaped %s session', async (_label, storedSession) => {
    const parser = vi.fn() as unknown as RequestHandler;
    const prisma = { session: { findUnique: vi.fn().mockResolvedValue(storedSession) } };
    const middleware = createScreenplayBodyMiddleware(
      { ...options, verifySession: (token) => findActiveSession(prisma as never, token) },
      parser,
    );
    const response = mockResponse();

    middleware(
      { method: 'POST', headers: { cookie: `coda_session=${validToken}` } } as never,
      response as never,
      vi.fn(),
    );
    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(401));

    expect(parser).not.toHaveBeenCalled();
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, detail: 'Authentication required' }),
    );
  });

  it('hydrates a verified session and invokes JSON parsing exactly once', async () => {
    const parser = vi.fn((_request, _response, callback: NextFunction) => {
      callback();
    }) as RequestHandler;
    const middleware = createScreenplayBodyMiddleware(options, parser);
    const response = mockResponse();
    const request_ = { method: 'POST', headers: { cookie: `coda_session=${validToken}` } };
    const next = vi.fn();

    middleware(request_ as never, response as never, next);
    await vi.waitFor(() => expect(parser).toHaveBeenCalledOnce());

    expect(request_).toMatchObject({
      user: activeSession.user,
      sessionId: activeSession.id,
      authenticationType: 'session',
      sessionAdmissionAuthenticated: true,
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('bounds concurrent session verification before JSON parsing', () => {
    const parser = vi.fn() as unknown as RequestHandler;
    const verifySession = vi.fn(() => new Promise<ActiveSession | null>(() => undefined));
    const middleware = createScreenplayBodyMiddleware({ ...options, verifySession }, parser);
    const request_ = { method: 'POST', headers: { cookie: `coda_session=${validToken}` } };
    middleware(request_ as never, mockResponse() as never, vi.fn());
    const second = mockResponse();
    middleware(request_ as never, second as never, vi.fn());

    expect(verifySession).toHaveBeenCalledTimes(1);
    expect(parser).not.toHaveBeenCalled();
    expect(second.status).toHaveBeenCalledWith(503);
  });

  it('reserves parser capacity for another session while preserving the global bound', async () => {
    const completions: NextFunction[] = [];
    const parser = vi.fn((_request, _response, callback: NextFunction) => {
      completions.push(callback);
    }) as RequestHandler;
    const differentSession = {
      ...activeSession,
      id: '00000000-0000-4000-8000-000000000099',
    };
    const middleware = createScreenplayBodyMiddleware(
      {
        ...options,
        maxConcurrent: 3,
        verifySession: vi.fn((token: string) =>
          Promise.resolve(token === fourthToken ? differentSession : activeSession),
        ),
      },
      parser,
    );
    const invoke = (token: string, ip: string) => {
      const response = mockResponse();
      middleware(
        { method: 'POST', headers: { cookie: `coda_session=${token}` }, ip } as never,
        response as never,
        vi.fn(),
      );
      return response;
    };

    invoke(validToken, '192.0.2.1');
    invoke(secondToken, '192.0.2.2');
    await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(2));

    const sameSession = invoke(thirdToken, '192.0.2.3');
    await vi.waitFor(() => expect(sameSession.status).toHaveBeenCalledWith(503));
    expect(sameSession.send).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'This session has too many screenplay bodies in progress; retry shortly',
      }),
    );

    invoke(fourthToken, '192.0.2.4');
    await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(3));
    const globalCapacity = invoke('e'.repeat(43), '192.0.2.5');
    expect(globalCapacity.status).toHaveBeenCalledWith(503);
    expect(globalCapacity.send).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'Screenplay body parsing is at capacity; retry shortly',
      }),
    );

    completions.forEach((complete) => complete());
  });

  it('bounds the process globally across distinct sessions', async () => {
    const parser = vi.fn() as unknown as RequestHandler;
    const sessionByToken = new Map(
      [validToken, secondToken, thirdToken].map((token, index) => [
        token,
        { ...activeSession, id: `00000000-0000-4000-8000-00000000000${index + 3}` },
      ]),
    );
    const middleware = createScreenplayBodyMiddleware(
      {
        ...options,
        maxConcurrent: 3,
        verifySession: vi.fn((token: string) => Promise.resolve(sessionByToken.get(token) ?? null)),
      },
      parser,
    );
    for (const [index, token] of [validToken, secondToken, thirdToken].entries()) {
      middleware(
        {
          method: 'POST',
          headers: { cookie: `coda_session=${token}` },
          ip: `198.51.100.${index + 1}`,
        } as never,
        mockResponse() as never,
        vi.fn(),
      );
    }
    await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(3));
    const rejected = mockResponse();
    middleware(
      {
        method: 'POST',
        headers: { cookie: `coda_session=${fourthToken}` },
        ip: '198.51.100.4',
      } as never,
      rejected as never,
      vi.fn(),
    );

    expect(rejected.status).toHaveBeenCalledWith(503);
    expect(parser).toHaveBeenCalledTimes(3);
  });

  it('does not let one unauthenticated client evade admission by rotating cookie values', () => {
    const verifySession = vi.fn(() => new Promise<ActiveSession | null>(() => undefined));
    const middleware = createScreenplayBodyMiddleware(
      { ...options, maxConcurrent: 3, verifySession },
      vi.fn() as unknown as RequestHandler,
    );
    const invoke = (token: string, ip: string) => {
      const response = mockResponse();
      middleware(
        { method: 'POST', headers: { cookie: `coda_session=${token}` }, ip } as never,
        response as never,
        vi.fn(),
      );
      return response;
    };

    invoke(validToken, '203.0.113.10');
    invoke(secondToken, '203.0.113.10');
    const rotated = invoke(thirdToken, '203.0.113.10');
    invoke(fourthToken, '203.0.113.11');

    expect(rotated.status).toHaveBeenCalledWith(503);
    expect(rotated.send).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'This client has too many screenplay bodies awaiting authentication; retry shortly',
      }),
    );
    expect(verifySession).toHaveBeenCalledTimes(3);
  });

  it('rate-limits sequential well-shaped invalid sessions before repeated database lookup', async () => {
    const verifySession = vi.fn().mockResolvedValue(null);
    const middleware = createScreenplayBodyMiddleware(
      {
        ...options,
        maxConcurrent: 10,
        preAuthMaxPerClient: 2,
        preAuthMaxGlobal: 10,
        verifySession,
      },
      vi.fn() as unknown as RequestHandler,
    );
    const invoke = (token: string) => {
      const response = mockResponse();
      middleware(
        {
          method: 'POST',
          headers: { cookie: `coda_session=${token}` },
          ip: '203.0.113.40',
        } as never,
        response as never,
        vi.fn(),
      );
      return response;
    };

    invoke(validToken);
    invoke(secondToken);
    const rejected = invoke(thirdToken);
    await vi.waitFor(() => expect(verifySession).toHaveBeenCalledTimes(2));

    expect(rejected.status).toHaveBeenCalledWith(429);
    expect(rejected.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('applies a bounded global pre-auth ceiling across distinct client addresses', () => {
    const middleware = createScreenplayBodyMiddleware(
      {
        ...options,
        maxConcurrent: 10,
        preAuthMaxPerClient: 2,
        preAuthMaxGlobal: 2,
        verifySession: vi.fn(() => new Promise<ActiveSession | null>(() => undefined)),
      },
      vi.fn() as unknown as RequestHandler,
    );
    const invoke = (token: string, ip: string) => {
      const response = mockResponse();
      middleware(
        { method: 'POST', headers: { cookie: `coda_session=${token}` }, ip } as never,
        response as never,
        vi.fn(),
      );
      return response;
    };

    invoke(validToken, '198.51.100.10');
    invoke(secondToken, '198.51.100.11');
    const rejected = invoke(thirdToken, '198.51.100.12');

    expect(rejected.status).toHaveBeenCalledWith(429);
  });

  it('rejects an over-limit large body before authentication or JSON parsing', async () => {
    const parser = vi.fn() as unknown as RequestHandler;
    const verifySession = vi.fn().mockResolvedValue(activeSession);
    const middleware = createScreenplayBodyMiddleware(
      {
        ...options,
        maxConcurrent: 10,
        preAuthMaxPerClient: 1,
        preAuthMaxGlobal: 10,
        verifySession,
      },
      parser,
    );
    const requestFor = (token: string) => ({
      method: 'POST',
      headers: { cookie: `coda_session=${token}`, 'content-length': '999999' },
      ip: '192.0.2.44',
    });
    middleware(requestFor(validToken) as never, mockResponse() as never, vi.fn());
    await vi.waitFor(() => expect(parser).toHaveBeenCalledOnce());
    const rejected = mockResponse();
    middleware(requestFor(secondToken) as never, rejected as never, vi.fn());

    expect(rejected.status).toHaveBeenCalledWith(429);
    expect(verifySession).toHaveBeenCalledOnce();
    expect(parser).toHaveBeenCalledOnce();
  });

  it('releases per-session and global capacity after parsing completes', async () => {
    const completions: NextFunction[] = [];
    const parser = vi.fn((_request, _response, callback: NextFunction) => {
      completions.push(callback);
    }) as RequestHandler;
    const middleware = createScreenplayBodyMiddleware(options, parser);
    const invoke = () => {
      const response = mockResponse();
      middleware(
        { method: 'POST', headers: { cookie: `coda_session=${validToken}` } } as never,
        response as never,
        vi.fn(),
      );
      return response;
    };

    invoke();
    await vi.waitFor(() => expect(parser).toHaveBeenCalledOnce());
    const rejected = invoke();
    await vi.waitFor(() => expect(rejected.status).toHaveBeenCalledWith(503));
    completions[0]!();
    invoke();
    await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(2));
    completions[1]!();
  });

  it('releases admission when the client disconnects during parsing', async () => {
    const parser = vi.fn() as unknown as RequestHandler;
    const middleware = createScreenplayBodyMiddleware(options, parser);
    const listeners = new Map<string, () => void>();
    const disconnected = mockResponse();
    disconnected.once.mockImplementation((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return disconnected;
    });

    middleware(
      { method: 'POST', headers: { cookie: `coda_session=${validToken}` } } as never,
      disconnected as never,
      vi.fn(),
    );
    await vi.waitFor(() => expect(parser).toHaveBeenCalledOnce());
    listeners.get('close')?.();

    middleware(
      { method: 'POST', headers: { cookie: `coda_session=${validToken}` } } as never,
      mockResponse() as never,
      vi.fn(),
    );
    await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(2));
  });

  it('terminates a stalled request after the admission timeout', async () => {
    vi.useFakeTimers();
    try {
      const parser = vi.fn() as unknown as RequestHandler;
      const middleware = createScreenplayBodyMiddleware({ ...options, timeoutMs: 50 }, parser);
      const request_ = {
        method: 'POST',
        headers: { cookie: `coda_session=${validToken}` },
        destroy: vi.fn(),
      };
      const response = mockResponse();
      const listeners = new Map<string, () => void>();
      response.once.mockImplementation((event: string, listener: () => void) => {
        listeners.set(event, listener);
        return response;
      });

      middleware(request_ as never, response as never, vi.fn());
      await Promise.resolve();
      await Promise.resolve();
      expect(parser).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(50);
      expect(response.status).toHaveBeenCalledWith(408);
      listeners.get('finish')?.();
      expect(request_.destroy).toHaveBeenCalledOnce();

      middleware(
        {
          method: 'POST',
          headers: { cookie: `coda_session=${validToken}` },
          destroy: vi.fn(),
        } as never,
        mockResponse() as never,
        vi.fn(),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(parser).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
