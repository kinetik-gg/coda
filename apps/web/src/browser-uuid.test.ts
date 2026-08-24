import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserUuid } from './browser-uuid';

afterEach(() => vi.unstubAllGlobals());

describe('createBrowserUuid', () => {
  it('prefers the platform randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'platform-uuid' });
    expect(createBrowserUuid()).toBe('platform-uuid');
  });

  it('falls back to getRandomValues and formats a v4 UUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab),
    });
    const uuid = createBrowserUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('falls back to Math.random when no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    const uuid = createBrowserUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
