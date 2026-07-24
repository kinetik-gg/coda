import { describe, expect, it } from 'vitest';
import { classifyDatabaseError, hintsForErrorClass, labelForErrorClass } from './database-error';

describe('classifyDatabaseError', () => {
  it('classifies DNS failures by Node error code', () => {
    expect(classifyDatabaseError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND db' })).toBe(
      'dns',
    );
    expect(classifyDatabaseError({ code: 'EAI_AGAIN', message: 'temporary failure' })).toBe('dns');
  });

  it('classifies refused connections by Node error code', () => {
    expect(classifyDatabaseError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })).toBe(
      'connection-refused',
    );
  });

  it('classifies timeouts by Node error code', () => {
    expect(classifyDatabaseError({ code: 'ETIMEDOUT' })).toBe('timeout');
    expect(classifyDatabaseError({ code: 'ESOCKETTIMEDOUT' })).toBe('timeout');
  });

  it('classifies auth, tls, and timeout failures by Prisma error code', () => {
    expect(classifyDatabaseError({ errorCode: 'P1000', message: 'Authentication failed' })).toBe(
      'auth',
    );
    expect(
      classifyDatabaseError({ errorCode: 'P1011', message: 'Error opening a TLS connection' }),
    ).toBe('tls');
    expect(classifyDatabaseError({ errorCode: 'P1002' })).toBe('timeout');
    expect(classifyDatabaseError({ errorCode: 'P1008' })).toBe('timeout');
  });

  it('falls back to message inspection when no known code is present', () => {
    expect(classifyDatabaseError(new Error('password authentication failed for user "x"'))).toBe(
      'auth',
    );
    expect(classifyDatabaseError(new Error('self signed certificate in certificate chain'))).toBe(
      'tls',
    );
    expect(new Error('SSL required')).toSatisfy(
      (error: Error) => classifyDatabaseError(error) === 'tls',
    );
    expect(classifyDatabaseError(new Error('Connection timed out after 5000ms'))).toBe('timeout');
    expect(classifyDatabaseError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(
      'connection-refused',
    );
    expect(classifyDatabaseError(new Error('getaddrinfo ENOTFOUND db.invalid'))).toBe('dns');
  });

  it('recognizes Prisma CLI stderr text carrying an error code without a structured field', () => {
    expect(classifyDatabaseError(new Error('Error: P1000: Authentication failed'))).toBe('auth');
    expect(classifyDatabaseError(new Error('Error: P1011: could not negotiate TLS'))).toBe('tls');
  });

  it('falls back to unknown for unrecognized shapes', () => {
    expect(classifyDatabaseError(new Error('a truly unexpected failure'))).toBe('unknown');
    expect(classifyDatabaseError('not an object')).toBe('unknown');
    expect(classifyDatabaseError(undefined)).toBe('unknown');
    expect(classifyDatabaseError(null)).toBe('unknown');
  });
});

describe('labelForErrorClass and hintsForErrorClass', () => {
  it('returns a non-empty label and at least one hint for every class', () => {
    const classes = ['dns', 'connection-refused', 'tls', 'auth', 'timeout', 'unknown'] as const;
    for (const errorClass of classes) {
      expect(labelForErrorClass(errorClass).length).toBeGreaterThan(0);
      expect(hintsForErrorClass(errorClass).length).toBeGreaterThan(0);
      for (const hint of hintsForErrorClass(errorClass)) {
        expect(hint.toLowerCase()).not.toContain('password=');
      }
    }
  });

  it('surfaces the sslmode hint for TLS failures', () => {
    expect(hintsForErrorClass('tls').join(' ')).toContain('sslmode=require');
  });
});
