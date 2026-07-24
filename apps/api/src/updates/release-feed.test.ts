import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLatestRelease,
  RELEASE_FEED_ASSET_NAME,
  RELEASE_FEED_REPOSITORY,
} from './release-feed';

const validDescriptor = {
  version: '1.2.3',
  image: 'ghcr.io/kinetik-gg/coda',
  digest: `sha256:${'a'.repeat(64)}`,
  bundleSha256: 'b'.repeat(64),
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchLatestRelease', () => {
  it('fetches the release, finds the release.json asset, and validates it', async () => {
    const releasePayload = {
      html_url: 'https://github.com/kinetik-gg/coda/releases/tag/v1.2.3',
      assets: [
        { name: 'coda-deployment-v1.2.3.tar.gz', browser_download_url: 'https://example/other' },
        { name: RELEASE_FEED_ASSET_NAME, browser_download_url: 'https://example/release.json' },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(releasePayload))
      .mockResolvedValueOnce(jsonResponse(validDescriptor));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchLatestRelease();

    expect(result).toEqual({
      descriptor: validDescriptor,
      notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.2.3',
    });
    const expectedHeaders = {
      accept: 'application/vnd.github+json',
      'user-agent': 'coda-release-checker',
    };
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.github.com/repos/${RELEASE_FEED_REPOSITORY}/releases/latest`,
      expect.objectContaining({ headers: expectedHeaders }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example/release.json',
      expect.objectContaining({ headers: expectedHeaders }),
    );
  });

  it('throws when the release has no release.json asset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ html_url: 'x', assets: [] })));

    await expect(fetchLatestRelease()).rejects.toThrow(/no release\.json asset/i);
  });

  it('throws on a malformed release.json payload', async () => {
    const releasePayload = {
      html_url: 'https://github.com/kinetik-gg/coda/releases/tag/v1.2.3',
      assets: [
        { name: RELEASE_FEED_ASSET_NAME, browser_download_url: 'https://example/release.json' },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(releasePayload))
        .mockResolvedValueOnce(jsonResponse({ version: 'not-semver' })),
    );

    await expect(fetchLatestRelease()).rejects.toThrow();
  });

  it('throws when the GitHub API responds with a non-OK status (offline / unreachable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 503)));

    await expect(fetchLatestRelease()).rejects.toThrow(/status 503/);
  });

  it('propagates a network-level rejection (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));

    await expect(fetchLatestRelease()).rejects.toThrow(/ENOTFOUND/);
  });

  it('defaults notesUrl to null when the release has no html_url', async () => {
    const releasePayload = {
      assets: [
        { name: RELEASE_FEED_ASSET_NAME, browser_download_url: 'https://example/release.json' },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(releasePayload))
        .mockResolvedValueOnce(jsonResponse(validDescriptor)),
    );

    await expect(fetchLatestRelease()).resolves.toMatchObject({ notesUrl: null });
  });
});
