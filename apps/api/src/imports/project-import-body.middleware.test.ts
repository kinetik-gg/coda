import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createProjectImportBodyMiddleware } from './project-import-body.middleware';

function responseHarness() {
  const listeners = new Map<string, Array<() => void>>();
  const status = vi.fn(() => response);
  const response = {
    once: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return response;
    }),
    status,
    type: vi.fn(() => response),
    send: vi.fn(() => response),
  };
  const emit = (event: string) => listeners.get(event)?.forEach((listener) => listener());
  return { response: response as unknown as Response, emit, status };
}

function importRequest(path = '/api/v1/projects/import', method = 'POST'): Request {
  return { path, method, user: { id: 'user' }, destroy: vi.fn() } as unknown as Request;
}

describe('createProjectImportBodyMiddleware', () => {
  it('parses only the exact project import route', () => {
    const parser = vi.fn((_request, _response, next: NextFunction) => next());
    const middleware = createProjectImportBodyMiddleware(parser as RequestHandler);
    const { response } = responseHarness();
    const next = vi.fn();

    middleware(importRequest('/api/v1/projects/missing'), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(parser).not.toHaveBeenCalled();
  });

  it('caps active buffered imports and releases capacity when parsing finishes', () => {
    const completions: NextFunction[] = [];
    const parser = vi.fn((_request, _response, next: NextFunction) => completions.push(next));
    const middleware = createProjectImportBodyMiddleware(parser as RequestHandler);
    const first = responseHarness();
    const second = responseHarness();
    const rejected = responseHarness();

    middleware(importRequest(), first.response, vi.fn());
    middleware(importRequest(), second.response, vi.fn());
    middleware(importRequest(), rejected.response, vi.fn());

    expect(parser).toHaveBeenCalledTimes(2);
    expect(rejected.status).toHaveBeenCalledWith(503);
    completions[0]?.();
    middleware(importRequest(), responseHarness().response, vi.fn());
    expect(parser).toHaveBeenCalledTimes(3);
  });

  it('rejects unauthenticated imports before reserving capacity or reading the body', () => {
    const parser = vi.fn();
    const middleware = createProjectImportBodyMiddleware(parser as RequestHandler);
    const rejected = responseHarness();
    const request = importRequest();
    request.user = undefined;

    middleware(request, rejected.response, vi.fn());

    expect(rejected.status).toHaveBeenCalledWith(401);
    expect(parser).not.toHaveBeenCalled();
  });

  it('terminates an authenticated body that misses the receipt deadline', () => {
    vi.useFakeTimers();
    const parser = vi.fn();
    const middleware = createProjectImportBodyMiddleware(parser as RequestHandler, 1_000);
    const timedOut = responseHarness();
    const request = importRequest();
    let destroyed = false;
    request.destroy = () => {
      destroyed = true;
      return request;
    };

    middleware(request, timedOut.response, vi.fn());
    vi.advanceTimersByTime(1_000);
    timedOut.emit('finish');

    expect(timedOut.status).toHaveBeenCalledWith(408);
    expect(destroyed).toBe(true);
    vi.useRealTimers();
  });
});
