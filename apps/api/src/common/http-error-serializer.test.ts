import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createRequestErrorSerializer } from './http-error-serializer';

const SENSITIVE_KEYS = ['body', 'headers', 'cookies', 'cookie', 'token', 'query', 'authorization'];

describe('request error serializer (redacted default)', () => {
  const serialize = createRequestErrorSerializer(false);

  it('flattens every error to a fixed redacted shape', () => {
    expect(serialize(new HttpException('boom', HttpStatus.BAD_REQUEST))).toEqual({
      type: 'HttpException',
      message: 'Request failed',
    });
  });

  it('labels non-Error values as a generic Error type', () => {
    expect(serialize('unexpected')).toEqual({ type: 'Error', message: 'Request failed' });
  });

  it('never carries the original message, status, or stack', () => {
    const error = new HttpException('secret detail', HttpStatus.INTERNAL_SERVER_ERROR);
    const serialized = serialize(error) as unknown as Record<string, unknown>;
    expect(serialized.message).toBe('Request failed');
    expect(serialized).not.toHaveProperty('status');
    expect(serialized).not.toHaveProperty('stack');
    expect(serialized.message).not.toContain('secret detail');
  });
});

describe('request error serializer (detail enabled)', () => {
  const serialize = createRequestErrorSerializer(true);

  it('includes sanitized name, message, and HTTP status for 4xx without a stack', () => {
    const error = new HttpException('Invalid input', HttpStatus.BAD_REQUEST);
    const serialized = serialize(error) as unknown as Record<string, unknown>;
    expect(serialized).toMatchObject({
      type: 'HttpException',
      message: 'Invalid input',
      status: 400,
    });
    expect(serialized).not.toHaveProperty('stack');
  });

  it('includes a stack trace for 5xx-class errors', () => {
    const error = new HttpException('Boom', HttpStatus.INTERNAL_SERVER_ERROR);
    const serialized = serialize(error) as unknown as Record<string, unknown>;
    expect(serialized.status).toBe(500);
    expect(serialized.message).toBe('Boom');
    expect(typeof serialized.stack).toBe('string');
    expect(serialized.stack).toContain('HttpException');
  });

  it('resolves status from a numeric status property', () => {
    const error = Object.assign(new Error('Gateway down'), { status: 502 });
    const serialized = serialize(error) as unknown as Record<string, unknown>;
    expect(serialized.status).toBe(502);
    expect(typeof serialized.stack).toBe('string');
  });

  it('resolves status from a numeric statusCode property', () => {
    const error = Object.assign(new Error('Not found'), { statusCode: 404 });
    const serialized = serialize(error) as unknown as Record<string, unknown>;
    expect(serialized.status).toBe(404);
    expect(serialized).not.toHaveProperty('stack');
  });

  it('defaults to a 500 status with a stack when no status is present', () => {
    const serialized = serialize(new Error('Unclassified failure')) as unknown as Record<string, unknown>;
    expect(serialized.status).toBe(500);
    expect(typeof serialized.stack).toBe('string');
  });

  it('ignores out-of-range status values and treats them as 500', () => {
    const error = Object.assign(new Error('Weird'), { status: 42 });
    const serialized = serialize(error) as unknown as Record<string, unknown>;
    expect(serialized.status).toBe(500);
  });

  it('handles non-Error values without a stack', () => {
    const serialized = serialize({ statusCode: 418 }) as unknown as Record<string, unknown>;
    expect(serialized).toEqual({ type: 'Error', message: 'Request failed', status: 418 });
  });

  it('never emits request bodies, headers, cookies, tokens, or query strings', () => {
    const error = Object.assign(new HttpException('Boom', HttpStatus.INTERNAL_SERVER_ERROR), {
      body: { password: 'hunter2' },
      headers: { authorization: 'Bearer super-secret-token' },
      cookies: { coda_session: 'session-secret' },
      query: { token: 'reset-token' },
      config: { headers: { cookie: 'coda_session=leak' } },
    });
    const serialized = serialize(error) as unknown as Record<string, unknown>;
    const emitted = JSON.stringify(serialized).toLowerCase();

    for (const key of SENSITIVE_KEYS) {
      expect(serialized).not.toHaveProperty(key);
    }
    expect(emitted).not.toContain('hunter2');
    expect(emitted).not.toContain('super-secret-token');
    expect(emitted).not.toContain('session-secret');
    expect(emitted).not.toContain('reset-token');
    expect(emitted).not.toContain('bearer');
    expect(Object.keys(serialized).sort()).toEqual(['message', 'stack', 'status', 'type']);
  });
});
