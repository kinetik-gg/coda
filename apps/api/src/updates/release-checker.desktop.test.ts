import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestRelease } from './release-feed';
import { ReleaseCheckerService } from './release-checker.service';

vi.mock('../config/env', () => ({ env: () => ({ UPDATE_CHECK_INTERVAL_HOURS: 24 }) }));
vi.mock('../config/runtime-capabilities', () => ({
  runtimeCapabilities: () => ({ updatePoller: 'disabled' }),
}));
vi.mock('./release-feed', () => ({ fetchLatestRelease: vi.fn() }));
vi.mock('./running-version', () => ({ runningVersion: vi.fn(() => '1.2.3') }));

const mockedFetch = vi.mocked(fetchLatestRelease);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ReleaseCheckerService under the desktop profile', () => {
  it('never arms the background poller even with a positive interval', () => {
    vi.useFakeTimers();
    const prisma = {
      releaseCheckState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new ReleaseCheckerService(prisma as never);

    service.onApplicationBootstrap();
    // Advance well beyond any jitter + interval window; a disabled poller makes zero network calls.
    vi.advanceTimersByTime(72 * 60 * 60 * 1_000);

    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
