import { afterEach, describe, expect, it } from 'vitest';
import {
  RUNTIME_PROFILES,
  resetRuntimeCapabilitiesCache,
  resolveRuntimeCapabilities,
  runtimeCapabilities,
  type RuntimeCapabilities,
} from './runtime-capabilities';

// The seven independent toggles measured by the #73 spike, as the capability-map key inventory.
const CAPABILITY_KEYS: Array<keyof RuntimeCapabilities> = [
  'setupTokenBootstrap',
  'databaseReadinessProbe',
  'devRedirect',
  'updatePoller',
  'schedulerCoordination',
  'trustedProxyHandling',
  'realtimeFanout',
];

afterEach(() => {
  resetRuntimeCapabilitiesCache();
});

describe('runtime capability map', () => {
  it('exposes exactly the server and desktop profiles', () => {
    expect([...RUNTIME_PROFILES]).toEqual(['server', 'desktop']);
  });

  it('defaults to the server preset when RUNTIME_PROFILE is unset', () => {
    expect(resolveRuntimeCapabilities({})).toEqual({
      setupTokenBootstrap: 'token-ceremony',
      databaseReadinessProbe: 'diagnostic-retry',
      devRedirect: 'follow-node-env',
      updatePoller: 'enabled',
      schedulerCoordination: 'advisory-lock',
      trustedProxyHandling: 'configured',
      realtimeFanout: 'multi-user',
    });
  });

  it('resolves the desktop preset to the single-user local toggles', () => {
    expect(resolveRuntimeCapabilities({ RUNTIME_PROFILE: 'desktop' })).toEqual({
      setupTokenBootstrap: 'local-owner',
      databaseReadinessProbe: 'quiet-retry',
      devRedirect: 'disabled',
      updatePoller: 'disabled',
      schedulerCoordination: 'single-process',
      trustedProxyHandling: 'loopback-only',
      realtimeFanout: 'single-user',
    });
  });

  it('treats an explicit server value the same as the default', () => {
    expect(resolveRuntimeCapabilities({ RUNTIME_PROFILE: 'server' })).toEqual(
      resolveRuntimeCapabilities({}),
    );
  });

  it('treats a blank RUNTIME_PROFILE as unset', () => {
    expect(resolveRuntimeCapabilities({ RUNTIME_PROFILE: '   ' })).toEqual(
      resolveRuntimeCapabilities({}),
    );
  });

  it('server and desktop presets differ on every capability key', () => {
    const server = resolveRuntimeCapabilities({ RUNTIME_PROFILE: 'server' });
    const desktop = resolveRuntimeCapabilities({ RUNTIME_PROFILE: 'desktop' });
    for (const key of CAPABILITY_KEYS) {
      expect(server[key], `expected ${key} to diverge between presets`).not.toBe(desktop[key]);
    }
  });

  it('rejects an unknown profile with an actionable error', () => {
    expect(() => resolveRuntimeCapabilities({ RUNTIME_PROFILE: 'laptop' })).toThrow(
      /RUNTIME_PROFILE must be one of server, desktop \(received "laptop"\)/u,
    );
  });

  it('caches the resolved map and re-reads after a reset', () => {
    const previous = process.env.RUNTIME_PROFILE;
    try {
      delete process.env.RUNTIME_PROFILE;
      resetRuntimeCapabilitiesCache();
      expect(runtimeCapabilities().setupTokenBootstrap).toBe('token-ceremony');
      // A later env change is ignored until the cache is cleared.
      process.env.RUNTIME_PROFILE = 'desktop';
      expect(runtimeCapabilities().setupTokenBootstrap).toBe('token-ceremony');
      resetRuntimeCapabilitiesCache();
      expect(runtimeCapabilities().setupTokenBootstrap).toBe('local-owner');
    } finally {
      if (previous === undefined) delete process.env.RUNTIME_PROFILE;
      else process.env.RUNTIME_PROFILE = previous;
      resetRuntimeCapabilitiesCache();
    }
  });
});
