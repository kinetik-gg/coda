import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createProjectImportBodyMiddleware } from './project-import-body.middleware';

function responseHarness() {
  const listeners = new Map<string, () => void>();
  const status = vi.fn(() => response);
  const response = {
    once: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return response;
    }),
    status,
    type: vi.fn(() => response),
    send: vi.fn(() => response),
  };
  return { response: response as unknown as Response, listeners, status };
}

function importRequest(path = '/api/v1/projects/import', method = 'POST'): Request {
  return { path, method } as Request;
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

  it('caps active buffered imports and releases capacity when a response finishes', () => {
    const parser = vi.fn();
    const middleware = createProjectImportBodyMiddleware(parser as RequestHandler);
    const first = responseHarness();
    const second = responseHarness();
    const rejected = responseHarness();

    middleware(importRequest(), first.response, vi.fn());
    middleware(importRequest(), second.response, vi.fn());
    middleware(importRequest(), rejected.response, vi.fn());

    expect(parser).toHaveBeenCalledTimes(2);
    expect(rejected.status).toHaveBeenCalledWith(503);
    first.listeners.get('finish')?.();
    middleware(importRequest(), responseHarness().response, vi.fn());
    expect(parser).toHaveBeenCalledTimes(3);
  });
});
