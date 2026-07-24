import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { computeStartupJitterMs } from './update-check-jitter';
import { fetchLatestRelease } from './release-feed';
import { classifyVersion } from './semver-compare';
import { runningVersion } from './running-version';
import type { ReleaseCheckStatus } from './release-checker.types';

const SINGLETON_ID = 'singleton';
const HOUR_MS = 60 * 60 * 1_000;

interface ReleaseCheckStateRow {
  latestVersion: string | null;
  latestImage: string | null;
  latestDigest: string | null;
  latestBundleSha256: string | null;
  notesUrl: string | null;
  lastCheckedAt: Date | null;
  lastSucceededAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}

const EMPTY_STATE: ReleaseCheckStateRow = {
  latestVersion: null,
  latestImage: null,
  latestDigest: null,
  latestBundleSha256: null,
  notesUrl: null,
  lastCheckedAt: null,
  lastSucceededAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
};

/**
 * Polls the latest GitHub release's `release.json` asset on a configurable interval,
 * persists what it learns, and exposes a typed status plus an on-demand check method.
 * Network egress happens only against the release feed; every failure is caught, logged
 * quietly, and never propagates, so it cannot affect application health.
 */
@Injectable()
export class ReleaseCheckerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReleaseCheckerService.name);
  private jitterTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  private checking = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    const hours = env().UPDATE_CHECK_INTERVAL_HOURS;
    if (hours <= 0) return; // 0 disables polling entirely: zero network calls
    const intervalMs = hours * HOUR_MS;
    const jitterMs = computeStartupJitterMs(intervalMs);
    this.jitterTimer = setTimeout(() => {
      void this.check();
      this.pollTimer = setInterval(() => void this.check(), intervalMs);
      this.pollTimer.unref();
    }, jitterMs);
    this.jitterTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.jitterTimer) clearTimeout(this.jitterTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Runs an immediate check regardless of the poll schedule, then returns the fresh status. */
  async check(): Promise<ReleaseCheckStatus> {
    if (!this.checking) {
      this.checking = true;
      try {
        await this.poll();
      } finally {
        this.checking = false;
      }
    }
    return this.status();
  }

  /** Returns the current status without triggering a network call. */
  async status(): Promise<ReleaseCheckStatus> {
    const row = await this.loadState();
    const current = runningVersion();
    const latest = row.latestVersion;
    const comparison = latest ? classifyVersion(current, latest) : 'unknown';
    const lastFailed =
      row.lastErrorAt !== null &&
      (row.lastSucceededAt === null || row.lastErrorAt > row.lastSucceededAt);
    return {
      current,
      latest,
      updateAvailable: comparison === 'behind',
      comparison,
      notesUrl: row.notesUrl,
      lastCheckedAt: row.lastCheckedAt,
      lastSucceededAt: row.lastSucceededAt,
      lastError: lastFailed ? row.lastErrorMessage : null,
    };
  }

  private async poll(): Promise<void> {
    const now = new Date();
    try {
      const { descriptor, notesUrl } = await fetchLatestRelease();
      await this.persistSuccess(now, descriptor, notesUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown release-check failure';
      this.logger.warn(`Release check failed: ${message}`);
      await this.persistFailure(now, message);
    }
  }

  private async loadState(): Promise<ReleaseCheckStateRow> {
    const row = await this.prisma.releaseCheckState.findUnique({ where: { id: SINGLETON_ID } });
    return row ?? EMPTY_STATE;
  }

  private async persistSuccess(
    checkedAt: Date,
    descriptor: { version: string; image: string; digest: string; bundleSha256: string },
    notesUrl: string | null,
  ): Promise<void> {
    const data = {
      latestVersion: descriptor.version,
      latestImage: descriptor.image,
      latestDigest: descriptor.digest,
      latestBundleSha256: descriptor.bundleSha256,
      notesUrl,
      lastCheckedAt: checkedAt,
      lastSucceededAt: checkedAt,
    };
    await this.prisma.releaseCheckState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
  }

  private async persistFailure(checkedAt: Date, message: string): Promise<void> {
    const data = { lastCheckedAt: checkedAt, lastErrorAt: checkedAt, lastErrorMessage: message };
    await this.prisma.releaseCheckState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
  }
}
