import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from './csrf.guard';
import { PUBLIC_ROUTE } from './public.decorator';

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;
}

function guardWith(publicRoute = false): CsrfGuard {
  const reflector = {
    getAllAndOverride: (key: string) => (key === PUBLIC_ROUTE ? publicRoute : undefined),
  } as unknown as Reflector;
  return new CsrfGuard(reflector);
}

describe('CsrfGuard authentication modes', () => {
  it('still requires matching CSRF values for a cookie session mutation', () => {
    const guard = guardWith();
    const request = {
      user: { id: 'user' },
      authenticationType: 'session',
      method: 'POST',
      cookies: { coda_csrf: 'cookie-value' },
      get: () => 'different-value',
    };

    expect(() => guard.canActivate(contextFor(request))).toThrow('CSRF');
  });

  it('does not require a browser CSRF cookie for bearer authentication', () => {
    const guard = guardWith();
    const request = {
      user: { id: 'user' },
      authenticationType: 'credential',
      method: 'POST',
      cookies: {},
      get: () => undefined,
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
  });

  it('exempts public routes so token-authorized proxy writes need no CSRF header', () => {
    const guard = guardWith(true);
    const request = {
      user: { id: 'user' },
      authenticationType: 'session',
      method: 'PUT',
      cookies: { coda_csrf: 'cookie-value' },
      get: () => undefined,
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
  });
});
