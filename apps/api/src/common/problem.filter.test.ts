import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { ProblemDetailsFilter } from './problem.filter';

function harness(originalUrl = '/api/items?token=secret', requestId = 'request-1') {
  const send = vi.fn();
  const type = vi.fn().mockReturnValue({ send });
  const status = vi.fn().mockReturnValue({ type });
  const request = { originalUrl, requestId };
  const response = { status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  return { host, send, status, type };
}

function knownPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('database failure', {
    code,
    clientVersion: 'test',
  });
}

describe('ProblemDetailsFilter', () => {
  it('groups Zod issues by field and sanitizes the request target', () => {
    const filter = new ProblemDetailsFilter();
    const result = z
      .object({ name: z.string().min(2), nested: z.object({ count: z.number().positive() }) })
      .safeParse({ name: '', nested: { count: 0 } });
    if (result.success) throw new Error('Expected validation to fail');
    const { host, send, status, type } = harness();

    filter.catch(result.error, host as never);

    expect(status).toHaveBeenCalledWith(400);
    expect(type).toHaveBeenCalledWith('application/problem+json');
    const payload = send.mock.calls[0]?.[0] as unknown as {
      title: string;
      instance: string;
      requestId: string;
      errors: Record<string, string[]>;
    };
    expect(payload).toMatchObject({
      title: 'Validation failed',
      instance: '/api/items',
      requestId: 'request-1',
    });
    expect(payload.errors.name).toHaveLength(1);
    expect(payload.errors['nested.count']).toHaveLength(1);
  });

  it.each([
    [new BadRequestException('invalid input'), 400, 'invalid input'],
    [new HttpException('plain failure', 418), 418, 'plain failure'],
    [new HttpException({ message: ['not text'] }, 422), 422, 'Http Exception'],
  ])('maps HTTP exceptions without exposing internals', (error, expectedStatus, detail) => {
    const { host, send, status } = harness('/api/items');
    new ProblemDetailsFilter().catch(error, host as never);
    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ detail }));
  });

  it.each([
    ['P2002', 409, 'A record with the same unique value already exists.'],
    ['P2025', 404, 'The requested record was not found.'],
    ['P2003', 409, 'The record is still referenced by other data.'],
    ['P2023', 400, 'A database identifier or value was malformed.'],
    ['P9999', 500, 'An unexpected error occurred.'],
  ])('maps Prisma code %s to stable public problem details', (code, expectedStatus, detail) => {
    const { host, send, status } = harness('/api/items');
    new ProblemDetailsFilter().catch(knownPrismaError(code), host as never);
    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ detail }));
  });

  it.each([new Error('private failure'), 'non-error'])(
    'hides unknown exception details',
    (error) => {
      const { host, send, status } = harness('/api/items');
      new ProblemDetailsFilter().catch(error, host as never);
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ detail: 'An unexpected error occurred.' }),
      );
    },
  );
});
