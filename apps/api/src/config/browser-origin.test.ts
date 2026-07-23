import { describe, expect, it } from 'vitest';
import { isBrowserOriginAllowed, requiresAllowedBrowserOrigin } from './browser-origin';

const development = {
  NODE_ENV: 'development' as const,
  APP_ORIGIN: 'http://localhost:5173',
  DEV_ALLOWED_ORIGINS: ['http://10.10.10.9:5173'],
};

describe('browser origin allowlist', () => {
  it('accepts the primary origin and explicit development origins', () => {
    expect(isBrowserOriginAllowed('http://localhost:5173', development)).toBe(true);
    expect(isBrowserOriginAllowed('http://10.10.10.9:5173', development)).toBe(true);
  });

  it('rejects malformed, absent, and unlisted origins', () => {
    expect(isBrowserOriginAllowed(undefined, development)).toBe(false);
    expect(isBrowserOriginAllowed('not an origin', development)).toBe(false);
    expect(isBrowserOriginAllowed('http://10.10.10.8:5173', development)).toBe(false);
  });

  it('ignores development origins in production', () => {
    expect(
      isBrowserOriginAllowed('http://10.10.10.9:5173', {
        ...development,
        NODE_ENV: 'production',
      }),
    ).toBe(false);
  });

  it('protects API and mutation requests without blocking public application assets', () => {
    expect(requiresAllowedBrowserOrigin('GET', '/api/v1/projects')).toBe(true);
    expect(requiresAllowedBrowserOrigin('GET', '/API/v1/projects')).toBe(true);
    expect(requiresAllowedBrowserOrigin('HEAD', '/api/v1/health/ready')).toBe(true);
    expect(requiresAllowedBrowserOrigin('POST', '/assets/index.js')).toBe(true);
    expect(requiresAllowedBrowserOrigin('GET', '/assets/index.js')).toBe(false);
    expect(requiresAllowedBrowserOrigin('HEAD', '/')).toBe(false);
  });
});
