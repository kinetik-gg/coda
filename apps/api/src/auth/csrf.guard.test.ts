import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from './csrf.guard';

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('CsrfGuard authentication modes', () => {
  it('still requires matching CSRF values for a cookie session mutation', () => {
    const guard = new CsrfGuard();
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
    const guard = new CsrfGuard();
    const request = {
      user: { id: 'user' },
      authenticationType: 'credential',
      method: 'POST',
      cookies: {},
      get: () => undefined,
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
  });
});
