import { describe, expect, it, vi } from 'vitest';
import { takeSensitiveRouteToken } from './sensitive-route-token';

describe('takeSensitiveRouteToken', () => {
  it('returns a reset token while immediately removing it from browser history', () => {
    const replaceState = vi.fn();

    const token = takeSensitiveRouteToken(
      { pathname: '/reset-password', search: '?token=secret&locale=en', hash: '#form' },
      { state: { route: 1 }, replaceState },
    );

    expect(token).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith({ route: 1 }, '', '/reset-password?locale=en#form');
  });

  it('does not rewrite unrelated URLs', () => {
    const replaceState = vi.fn();

    expect(
      takeSensitiveRouteToken(
        { pathname: '/projects', search: '?token=ordinary-filter', hash: '' },
        { state: null, replaceState },
      ),
    ).toBe('');
    expect(replaceState).not.toHaveBeenCalled();
  });
});
