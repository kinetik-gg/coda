import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayCacheControlInterceptor } from './screenplay-cache-control.interceptor';

describe('ScreenplayCacheControlInterceptor', () => {
  it('marks screenplay responses private and cookie-varying without discarding existing Vary', () => {
    const headers = new Map<string, string>([['Vary', 'Origin']]);
    const response = {
      getHeader: vi.fn((name: string) => headers.get(name)),
      setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    };
    const context = { switchToHttp: () => ({ getResponse: () => response }) };

    new ScreenplayCacheControlInterceptor().intercept(context as never, { handle: () => of(null) });

    expect(headers.get('Cache-Control')).toBe('private,no-store');
    expect(headers.get('Vary')).toBe('Origin, Cookie');
  });
});
