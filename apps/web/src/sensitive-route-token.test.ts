import { describe, expect, it, vi } from 'vitest';
import { clearSensitiveRouteToken, takeSensitiveRouteToken } from './sensitive-route-token';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

describe('takeSensitiveRouteToken', () => {
  it('returns a reset token while immediately removing it from browser history', () => {
    const replaceState = vi.fn();
    const routeStorage = storage();

    const token = takeSensitiveRouteToken(
      { pathname: '/reset-password', search: '?token=secret&locale=en', hash: '#form' },
      { state: { route: 1 }, replaceState },
      routeStorage,
    );

    expect(token).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith({ route: 1 }, '', '/reset-password?locale=en#form');
    expect(routeStorage.setItem).toHaveBeenCalledWith(
      'coda:sensitive-route-token:/reset-password',
      'secret',
    );
  });

  it('restores a scrubbed invitation token after a reload and clears it after use', () => {
    const routeStorage = storage();
    const history = { state: null, replaceState: vi.fn() };

    expect(
      takeSensitiveRouteToken(
        { pathname: '/accept-invitation', search: '?token=invite-secret', hash: '' },
        history,
        routeStorage,
      ),
    ).toBe('invite-secret');
    expect(
      takeSensitiveRouteToken(
        { pathname: '/accept-invitation', search: '', hash: '' },
        history,
        routeStorage,
      ),
    ).toBe('invite-secret');

    clearSensitiveRouteToken('/accept-invitation', routeStorage);
    expect(
      takeSensitiveRouteToken(
        { pathname: '/accept-invitation', search: '', hash: '' },
        history,
        routeStorage,
      ),
    ).toBe('');
  });

  it('does not rewrite unrelated URLs', () => {
    const replaceState = vi.fn();

    expect(
      takeSensitiveRouteToken(
        { pathname: '/breakdowns', search: '?token=ordinary-filter', hash: '' },
        { state: null, replaceState },
      ),
    ).toBe('');
    expect(replaceState).not.toHaveBeenCalled();
  });
});
