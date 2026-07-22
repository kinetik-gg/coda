import express, { type NextFunction, type RequestHandler } from 'express';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { findActiveSession, type ActiveSession } from '../auth/session-authentication';
import { createScreenplayBodyMiddleware, installBodyParsers } from './body-parsers';

const validToken = 'a'.repeat(43);
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
  maxConcurrent: 1,
  timeoutMs: 5_000,
  verifySession: vi.fn().mockResolvedValue(activeSession),
};

function testApplication() {
  const application = express();
  installBodyParsers(application as unknown as Pick<INestApplication, 'use'>, options);
  application.post('/api/v1/screenplays/import', (request_, response) => {
    response.json({ length: (request_.body as { sourceText: string }).sourceText.length });
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
    } finally {
      vi.useRealTimers();
    }
  });
});
