import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { fetchLatestRelease } from './release-feed';
import { runningVersion } from './running-version';
import { ReleaseCheckerService } from './release-checker.service';

vi.mock('../config/env', () => ({ env: vi.fn() }));
vi.mock('./release-feed', () => ({ fetchLatestRelease: vi.fn() }));
vi.mock('./running-version', () => ({ runningVersion: vi.fn(() => '1.2.3') }));

const mockedEnv = vi.mocked(env);
const mockedFetch = vi.mocked(fetchLatestRelease);
const mockedRunningVersion = vi.mocked(runningVersion);

function mockPrisma(row: unknown = null) {
  return {
    releaseCheckState: {
      findUnique: vi.fn().mockResolvedValue(row),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => {
  mockedRunningVersion.mockReturnValue('1.2.3');
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ReleaseCheckerService status', () => {
  it('reports unknown/no update when never checked', async () => {
    const prisma = mockPrisma(null);
    const service = new ReleaseCheckerService(prisma as never);

    await expect(service.status()).resolves.toEqual({
      current: '1.2.3',
      latest: null,
      updateAvailable: false,
      comparison: 'unknown',
      notesUrl: null,
      lastCheckedAt: null,
      lastSucceededAt: null,
      lastError: null,
    });
  });

  it('returns the latest release target when a full descriptor is recorded', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const prisma = mockPrisma({
      latestVersion: '1.3.0',
      latestImage: 'ghcr.io/kinetik-gg/coda',
      latestDigest: digest,
      latestBundleSha256: 'b'.repeat(64),
      notesUrl: null,
      lastCheckedAt: new Date(),
      lastSucceededAt: new Date(),
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const service = new ReleaseCheckerService(prisma as never);
    await expect(service.latestReleaseTarget()).resolves.toEqual({
      version: '1.3.0',
      image: 'ghcr.io/kinetik-gg/coda',
      digest,
    });
  });

  it('returns no release target when the descriptor is incomplete', async () => {
    const prisma = mockPrisma({
      latestVersion: '1.3.0',
      latestImage: null,
      latestDigest: null,
      latestBundleSha256: null,
      notesUrl: null,
      lastCheckedAt: new Date(),
      lastSucceededAt: new Date(),
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const service = new ReleaseCheckerService(prisma as never);
    await expect(service.latestReleaseTarget()).resolves.toBeNull();
  });

  it('reports behind with updateAvailable when the latest is newer', async () => {
    const checkedAt = new Date('2026-01-01T00:00:00.000Z');
    const prisma = mockPrisma({
      latestVersion: '1.3.0',
      latestImage: 'ghcr.io/kinetik-gg/coda',
      latestDigest: `sha256:${'a'.repeat(64)}`,
      latestBundleSha256: 'b'.repeat(64),
      notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.3.0',
      lastCheckedAt: checkedAt,
      lastSucceededAt: checkedAt,
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const service = new ReleaseCheckerService(prisma as never);

    await expect(service.status()).resolves.toMatchObject({
      latest: '1.3.0',
      comparison: 'behind',
      updateAvailable: true,
      lastError: null,
    });
  });

  it('reports ahead without updateAvailable for a dev build past the latest release', async () => {
    mockedRunningVersion.mockReturnValue('1.4.0-dev');
    const prisma = mockPrisma({
      latestVersion: '1.3.0',
      latestImage: null,
      latestDigest: null,
      latestBundleSha256: null,
      notesUrl: null,
      lastCheckedAt: new Date(),
      lastSucceededAt: new Date(),
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const service = new ReleaseCheckerService(prisma as never);

    await expect(service.status()).resolves.toMatchObject({
      comparison: 'ahead',
      updateAvailable: false,
    });
  });

  it('reports current when versions match', async () => {
    const prisma = mockPrisma({
      latestVersion: '1.2.3',
      latestImage: null,
      latestDigest: null,
      latestBundleSha256: null,
      notesUrl: null,
      lastCheckedAt: new Date(),
      lastSucceededAt: new Date(),
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const service = new ReleaseCheckerService(prisma as never);

    await expect(service.status()).resolves.toMatchObject({
      comparison: 'current',
      updateAvailable: false,
    });
  });

  it('surfaces the last error only when the most recent attempt failed', async () => {
    const succeededAt = new Date('2026-01-01T00:00:00.000Z');
    const erroredAt = new Date('2026-01-02T00:00:00.000Z');
    const stillFailing = mockPrisma({
      latestVersion: '1.2.3',
      latestImage: null,
      latestDigest: null,
      latestBundleSha256: null,
      notesUrl: null,
      lastCheckedAt: erroredAt,
      lastSucceededAt: succeededAt,
      lastErrorAt: erroredAt,
      lastErrorMessage: 'boom',
    });
    await expect(new ReleaseCheckerService(stillFailing as never).status()).resolves.toMatchObject({
      lastError: 'boom',
    });

    const recoveredAt = new Date('2026-01-03T00:00:00.000Z');
    const recovered = mockPrisma({
      latestVersion: '1.2.3',
      latestImage: null,
      latestDigest: null,
      latestBundleSha256: null,
      notesUrl: null,
      lastCheckedAt: recoveredAt,
      lastSucceededAt: recoveredAt,
      lastErrorAt: erroredAt,
      lastErrorMessage: 'boom',
    });
    await expect(new ReleaseCheckerService(recovered as never).status()).resolves.toMatchObject({
      lastError: null,
    });
  });
});

describe('ReleaseCheckerService.check', () => {
  it('persists a successful check and returns the fresh status', async () => {
    const prisma = mockPrisma(null);
    mockedFetch.mockResolvedValue({
      descriptor: {
        version: '1.3.0',
        image: 'ghcr.io/kinetik-gg/coda',
        digest: `sha256:${'a'.repeat(64)}`,
        bundleSha256: 'b'.repeat(64),
      },
      notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.3.0',
    });
    prisma.releaseCheckState.findUnique.mockResolvedValueOnce({
      latestVersion: '1.3.0',
      latestImage: 'ghcr.io/kinetik-gg/coda',
      latestDigest: `sha256:${'a'.repeat(64)}`,
      latestBundleSha256: 'b'.repeat(64),
      notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.3.0',
      lastCheckedAt: new Date(),
      lastSucceededAt: new Date(),
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const service = new ReleaseCheckerService(prisma as never);

    const status = await service.check();

    expect(status).toMatchObject({ latest: '1.3.0', comparison: 'behind', updateAvailable: true });
    expect(prisma.releaseCheckState.upsert).toHaveBeenCalledOnce();
    const call = prisma.releaseCheckState.upsert.mock.calls[0]?.[0] as {
      where: { id: string };
      update: { latestVersion: string; lastErrorAt?: unknown };
    };
    expect(call.where).toEqual({ id: 'singleton' });
    expect(call.update.latestVersion).toBe('1.3.0');
    expect(call.update).not.toHaveProperty('lastErrorAt');
  });

  it('never throws on a network failure, and quietly persists the error', async () => {
    const prisma = mockPrisma(null);
    mockedFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'));

    const service = new ReleaseCheckerService(prisma as never);

    await expect(service.check()).resolves.toMatchObject({ latest: null });
    expect(prisma.releaseCheckState.upsert).toHaveBeenCalledOnce();
    const call = prisma.releaseCheckState.upsert.mock.calls[0]?.[0] as {
      update: { lastErrorMessage: string };
    };
    expect(call.update.lastErrorMessage).toMatch(/ENOTFOUND/);
  });

  it('never throws when the release feed returns malformed release.json', async () => {
    const prisma = mockPrisma(null);
    mockedFetch.mockRejectedValue(new Error('Malformed SemVer version'));

    const service = new ReleaseCheckerService(prisma as never);

    await expect(service.check()).resolves.toMatchObject({ comparison: 'unknown' });
  });

  it('coalesces overlapping on-demand checks into a single network call', async () => {
    const prisma = mockPrisma(null);
    let resolveFetch!: (value: Awaited<ReturnType<typeof fetchLatestRelease>>) => void;
    mockedFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const service = new ReleaseCheckerService(prisma as never);

    const first = service.check();
    const second = service.check();
    resolveFetch({
      descriptor: {
        version: '1.3.0',
        image: 'ghcr.io/kinetik-gg/coda',
        digest: `sha256:${'a'.repeat(64)}`,
        bundleSha256: 'b'.repeat(64),
      },
      notesUrl: null,
    });
    await Promise.all([first, second]);

    expect(mockedFetch).toHaveBeenCalledOnce();
  });
});

describe('ReleaseCheckerService bootstrap scheduling', () => {
  it('performs zero network calls when polling is disabled', () => {
    vi.useFakeTimers();
    mockedEnv.mockReturnValue({ UPDATE_CHECK_INTERVAL_HOURS: 0 } as never);
    const prisma = mockPrisma(null);
    const service = new ReleaseCheckerService(prisma as never);

    service.onApplicationBootstrap();
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1_000);

    expect(mockedFetch).not.toHaveBeenCalled();
    service.onApplicationShutdown();
  });

  it('schedules a jittered first check and recurring checks thereafter', async () => {
    vi.useFakeTimers();
    mockedEnv.mockReturnValue({ UPDATE_CHECK_INTERVAL_HOURS: 24 } as never);
    mockedFetch.mockResolvedValue({
      descriptor: {
        version: '1.2.3',
        image: 'ghcr.io/kinetik-gg/coda',
        digest: `sha256:${'a'.repeat(64)}`,
        bundleSha256: 'b'.repeat(64),
      },
      notesUrl: null,
    });
    const prisma = mockPrisma(null);
    const service = new ReleaseCheckerService(prisma as never);

    service.onApplicationBootstrap();
    // Jitter is capped at 5 minutes; advancing past it triggers the first check.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(mockedFetch).toHaveBeenCalledTimes(2);

    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});
